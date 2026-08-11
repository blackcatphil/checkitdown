"""
WYNN TOURNAMENT INGEST — reads the published documents, writes to whatever
DATABASE_URL it is given, and verifies by reading back.

═══ WHY THIS IS NOT THE QUEUE ═══

The house rule is that the queue is the only write path, and it is a good rule.
It does not fit here, for two reasons that are about judgement rather than
convenience:

  1. approve_change's allowlist is rooms / cash_games / room_amenities /
     room_descriptions. Tournament tables are not on it, so "through the queue"
     is not an option that exists today without a migration.
  2. 659 level rows as individual proposals is not review. Approving
     "level 17: 1,000/1,500" in isolation is not a decision a person can make —
     the unit of judgement is the STRUCTURE SHEET, which is correct as a whole
     or wrong as a whole. A queue that asks 659 times is a queue nobody reads,
     and a rubber-stamped queue is worse than none because it looks like
     oversight.

So the unit of change here is THE DOCUMENT, and this script carries the guard
rails the queue would otherwise have provided:

  · CITED — every row gets the live URL and this run's fetched_at, and the
    sources rows are registered data_type 'tournaments' (web tier), so
    precedence ranks them and a floor visit can still correct them.
  · PRECEDENCE-RESPECTING — refuses to overwrite a template whose levels are
    floor-sourced with web-sourced ones.
  · LOGGED AT THE RIGHT GRANULARITY — one change_log row per sheet replaced,
    not 659. An audit trail a human can actually read.
  · ASSERTED BEFORE COMMIT — contiguity and monotonicity re-run inside the
    transaction; a bad transcription cannot land.
  · IDEMPOTENT BY CONTENT — each sheet is hashed; an unchanged document writes
    nothing and logs nothing.
"""
import hashlib, json, os, re, subprocess, sys, urllib.request, datetime

VEGAS_TZ = '-07'
SCHED = ('https://cdn.wynnresorts.com/image/upload/v1753296112/visitwynn_pdfs_files/'
         'Poker/Wynn%20Signature%20Series/Wynn_Signature_Series_Schedule.pdf')
STRUCT = ('https://cdn.wynnresorts.com/image/upload/v1762299460/visitwynn_pdfs_files/'
          'Poker/Wynn%20Signature%20Series/Wynn_Signature_Series_Structures.pdf')
POSTER = ('https://cdn.wynnresorts.com/image/upload/v1752011166/visitwynn_pdfs_files/'
          'Poker/Daily%20Tournaments/poker-daily-tournament-poster.pdf')
DAILY_STRUCT = ('https://cdn.wynnresorts.com/image/upload/v1752011191/visitwynn_pdfs_files/'
                'Poker/Daily%20Tournaments/Poker-All_Daily_Structures.pdf')

N = lambda s: int(str(s).replace(',', ''))
Q = lambda s: "'" + str(s).replace("'", "''") + "'"

def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()

def pages(raw):
    import pypdf, io
    return [re.sub(r'[ \t]+', ' ', p.extract_text() or '')
            for p in pypdf.PdfReader(io.BytesIO(raw)).pages]

# ── structure sheets ──────────────────────────────────────────────────
MAIN  = re.compile(r'^ ?(\d{1,2}) ([\d,]+) ([\d,]+) ([\d,]+) ?$', re.M)
LIMIT = re.compile(r'^ ?(\d{1,2}) ([\d,]+) ([\d,]+) ([\d,]+)-([\d,]+) ?$', re.M)
ROT_L = re.compile(r'^ ?Limit Games ([\d,]+) ([\d,]+) ([\d,]+)-([\d,]+) ?$', re.M)
ROT_S = re.compile(r'^ ?Stud Games ([\d,]+) ([\d,]+) ([\d,]+) ([\d,]+)-([\d,]+) ?$', re.M)
LVLNUM = re.compile(r'^ ?(\d{1,2}) ?$', re.M)

def parse_sheet(t):
    lim = LIMIT.findall(t)
    if lim:
        return [dict(level_number=N(a), game_type='limit', small_blind=N(b), big_blind=N(c),
                     ante=0, small_bet=N(d), big_bet=N(e)) for a, b, c, d, e in lim]
    l_rows, s_rows = ROT_L.findall(t), ROT_S.findall(t)
    if l_rows and s_rows:
        nums = [N(x) for x in LVLNUM.findall(t)]
        out = []
        for i, (sb, bb, sbet, bbet) in enumerate(l_rows):
            out.append(dict(level_number=nums[i], game_type='limit', small_blind=N(sb),
                            big_blind=N(bb), ante=0, small_bet=N(sbet), big_bet=N(bbet)))
        for i, (ante, bring, comp, sbet, bbet) in enumerate(s_rows):
            out.append(dict(level_number=nums[i], game_type='stud', small_blind=N(bring),
                            big_blind=N(comp), ante=N(ante), small_bet=N(sbet), big_bet=N(bbet)))
        return out
    return [dict(level_number=N(a), game_type='main', small_blind=N(b), big_blind=N(c),
                 ante=N(d), small_bet=None, big_bet=None) for a, b, c, d in MAIN.findall(t)]

def sheet_hash(levels):
    """Content identity of one structure sheet. An unchanged sheet writes nothing."""
    canon = json.dumps(sorted(
        [[l['level_number'], l['game_type'], l['small_blind'], l['big_blind'],
          l['ante'], l['small_bet'], l['big_bet']] for l in levels]), separators=(',', ':'))
    return hashlib.sha256(canon.encode()).hexdigest()[:16]

def assert_fidelity(levels, where):
    """⚠️ A WRONG BLIND LEVEL IS SILENT. Re-run before commit, every run."""
    by = {}
    for l in levels:
        by.setdefault(l['game_type'], []).append(l)
    for gt, rows in by.items():
        rows.sort(key=lambda r: r['level_number'])
        nums = [r['level_number'] for r in rows]
        if nums != list(range(1, len(nums) + 1)):
            raise SystemExit(f'FIDELITY {where}/{gt}: levels not contiguous from 1: {nums[:5]}…')
        for a, b in zip(rows, rows[1:]):
            for k in ('small_blind', 'big_blind', 'ante'):
                if b[k] < a[k]:
                    raise SystemExit(f'FIDELITY {where}/{gt} L{b["level_number"]}: {k} decreased')
        for r in rows:
            if gt in ('limit', 'stud') and (r['small_bet'] is None or r['big_bet'] is None):
                raise SystemExit(f'FIDELITY {where}/{gt} L{r["level_number"]}: missing bet sizes')

# ── the schedule ──────────────────────────────────────────────────────
ROW = re.compile(r'^(\d{1,2})/(\d{1,2}) (\w{3}) (\d{1,2}) (A|P)\.M\. (.+?)\s*$')
SPLIT = re.compile(r'\$([\d,]+) Buy-?in = \$([\d,]+) \(Tournament Prize Pool\) \+ '
                   r'\$([\d,]+) \(Tournament Fee\) \+ \$([\d,]+) \(Poker Staff Service Charge\)')
MINS = re.compile(r'(\d+) minutes per level')
GUAR = re.compile(r'\$([\d,]+) Guarantee', re.I)
LATE = re.compile(r'until the start of level (\d+)')
RANGE = re.compile(r'(August|September) (\d{1,2})\s*[-–]\s*(?:(August|September) )?(\d{1,2}),? 2026')
MONTHS = {'August': 8, 'September': 9}

# ⚠️ THE SCHEDULE'S "LEVELS" COLUMN IS MINUTES PER LEVEL, NOT A LEVEL COUNT.
# The $400 NLH row says 40 and its sheet lists 28 levels; its terms read
# "Day 1: 40 minutes per level". Mapping it to a count would produce 40-level
# tournaments that have 28, and nothing about the result would look wrong. The
# count is never taken from the schedule — it comes from the transcribed rows.
# SCHEDULE ROW -> STRUCTURE SHEET. Each entry is (row pattern, entry amount,
# sheet name, guarantee) and the sheet must match EXACTLY ONE candidate — the
# schedule's wording and the sheet's title are different strings, and matching
# one against the other silently placed nothing.
# The last entry is the one that needs a guarantee to be decidable: p42 and p18
# are both $400 with a $30,000 guarantee, and only the name separates them.
FAMILIES = [
    (r'NLH TURBO',                 200,  'NLH Turbo',       None),
    (r'NO LIMIT HOLD.EM \$25,000',  300,  'No Limit Hold’em', None),
    (r'LIMIT OMAHA 8',             400,  'Limit Omaha 8',   None),
    (r'LIMIT OMAHA 8',             600,  'Limit Omaha 8',   None),
    (r'\bHORSE\b',                 400,  'HORSE',           None),
    (r'\bHORSE\b',                 600,  'HORSE',           None),
    (r'\bTORSE\b',                 400,  'TORSE',           None),
    (r'\bTORSE\b',                 600,  'TORSE',           None),
    (r'SENIORS NLH 50\+',           400,  'Seniors NLH 50+', None),
    (r'\bBIG O\b',                 400,  'Big O',           None),
    (r'\bBIG O\b',                 600,  'Big O',           None),
    (r'5-CARD PLO',                600,  '5-Card PLO',      None),
    (r'\bPLO\b',                   400,  'PLO',             None),
    (r'\bPLO\b',                   600,  'PLO',             None),
    (r'MILESTONE SATELLITE',       200,  None,              None),
    (r'NO LIMIT HOLD.EM \$30,000',  400,  'No Limit Hold’em', 30000),
]

def clean_name(head):
    """The event's name from its structure-sheet title.

    CUT AT A PREFIX, NOT AT AN EXACT PHRASE. This matched 'Entry Fee' exactly
    and one page in twenty-two extracts as 'Entry Fe' — enough to leave the
    buy-in in the name, produce a slug of its own, and insert a TWENTY-THIRD
    template alongside the twenty-two that already existed. Nothing about the
    row looked wrong; the verify step caught it on the count.
    So the cut is the first of several markers, each a prefix of what the page
    might render, and the trailing buy-in is stripped separately rather than
    relied on being consumed by the same match."""
    n = head
    for marker in (' Entry Fe', ' Level Small', ' LEVEL TYPE', ' Level '):
        i = n.find(marker)
        if i > 0:
            n = n[:i]
            break
    n = re.sub(r'\s*\$[\d,]+\s*$', '', n).strip()      # trailing buy-in
    n = re.sub(r'^\$[\d,]+\s*', '', n).strip()          # leading buy-in
    return n or 'No Limit Hold’em'

GAME = lambda n: ('mixed' if re.search(r'HORSE|TORSE', n, re.I) else
                  'plo5' if re.search(r'5-Card PLO', n, re.I) else
                  'other' if re.search(r'Big O|Omaha', n, re.I) else
                  'plo' if re.search(r'\bPLO\b', n, re.I) else 'nlh')

def build(struct_pages, sched_pages):
    sheets = []
    for i, t in enumerate(struct_pages):
        levels = parse_sheet(t)
        if not levels:
            continue
        tc = re.sub(r'\s+', ' ', struct_pages[i + 1]) if i + 1 < len(struct_pages) else ''
        m = SPLIT.search(tc)
        if not m:
            raise SystemExit(f'p{i+1}: no fee split found — refusing to guess a buy-in')
        head = re.sub(r'\s+', ' ', t).strip()
        name = clean_name(head)
        assert_fidelity(levels, f'p{i+1}')
        rng = RANGE.search(tc)
        sheets.append(dict(
            page=i + 1, name=name, levels=levels, hash=sheet_hash(levels),
            total=N(m.group(1)), prize=N(m.group(2)), fee=N(m.group(3)), staff=N(m.group(4)),
            minutes=int(MINS.search(tc).group(1)) if MINS.search(tc) else None,
            guarantee=N(GUAR.search(tc).group(1)) if GUAR.search(tc) else None,
            late=int(LATE.search(tc).group(1)) if LATE.search(tc) else None,
            slug=f"wynn-series-{re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')}-{N(m.group(1))}-p{i+1}",
            range=(datetime.date(2026, MONTHS[rng.group(1)], int(rng.group(2))),
                   datetime.date(2026, MONTHS[rng.group(3) or rng.group(1)], int(rng.group(4))))
                  if rng else None))

    t = sched_pages[0]
    rows = [l.strip() for l in t[t.find('DATE DAY TIME EVENT'):].split('\n') if l.strip()][1:]
    flights = [s for s in sheets if s['range'] and 'Satellite' not in s['name']]
    instances, unassigned = [], []
    for line in rows:
        m = ROW.match(line)
        if not m:
            unassigned.append((line, 'row did not parse')); continue
        mo, da, _dow, hh, ap, rest = m.groups()
        d = datetime.date(2026, int(mo), int(da))
        hour = int(hh) % 12 + (12 if ap == 'P' else 0)
        e = re.search(r'\$([\d,]+) [\d,]+ [\d/]+\s*$', rest)
        entry = N(e.group(1)) if e else None
        up, sheet, kind = rest.upper(), None, 'entry'
        if re.search(r'NO LIMIT HOLD.EM DAY', up):
            kind = 'continuation' if 'DAY 2' in up else 'flight'
            cands = [s for s in flights if s['range'][0] <= d <= s['range'][1]]
            if kind == 'flight':
                cands = [s for s in cands if s['total'] == entry]
            if len(cands) != 1:
                unassigned.append((line, f'{len(cands)} sheets match {d}/{entry}')); continue
            sheet = cands[0]
        else:
            for pat, amt, sheet_name, guar in FAMILIES:
                if not (re.search(pat, up) and entry == amt):
                    continue
                cand = [x for x in sheets if x['total'] == amt
                        and (sheet_name is None or x['name'] == sheet_name)
                        and (sheet_name is not None or x['name'].startswith('Milestone'))
                        and (guar is None or x['guarantee'] == guar)]
                # EXACTLY ONE, or it is not a match. An ambiguous placement is
                # how a level structure ends up attached to the wrong event.
                if len(cand) == 1:
                    sheet = cand[0]; break
            if sheet is None:
                unassigned.append((line, f'no family match (entry {entry})')); continue
        instances.append(dict(slug=sheet['slug'], date=d.isoformat(), hour=hour, kind=kind))
    # NOTHING IS SILENTLY DROPPED. A row this cannot place stops the run.
    if unassigned:
        for u in unassigned:
            print(f'  UNASSIGNED {u[0][:70]} -> {u[1]}', file=sys.stderr)
        raise SystemExit(f'{len(unassigned)} scheduled rows could not be placed — refusing to '
                         f'ingest a partial schedule')
    return sheets, instances

# ── apply ─────────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════
# THE FOUR DAILIES.
# ══════════════════════════════════════════════════════════════════════
# Under the standing rule a daily gets its room's published PDF and a fetched
# date — NOT a level-by-level transcription. So these are four template rows
# with no levels, and that is complete rather than partial.
#
# They are DECLARED HERE rather than parsed out of the poster. The poster is a
# marketing image whose useful content includes prose conditions — "unlimited
# $200 rebuys at 15,000 chips or less, and one $100 add-on" — that were read by
# a person once and are not safely re-derivable by a parser. Re-deriving them
# every morning would risk a silent mistranscription of a rebuy rule, which is
# the kind of falsehood this product exists not to publish.
#
# ⚠️ THIS IS A SECOND COPY OF THE SEED'S TRANSCRIPTION, AND THE PAIR IS GATED.
# `lib/wynn-dailies.test.mjs` parses this list and the matching block in
# supabase/seed.sql and diffs them on all 18 stored columns — slug, name, game,
# time, days, the three amounts, guarantee, stack, minutes, late level,
# re-entry, the note, the document date, its source, and both URLs. It runs
# under `test:unit`, reads two files off disk, and touches neither the network
# nor a database.
#
# ONLY TWO COLUMNS ARE EXEMPT, by name: structure_fetched_at and fetched_at.
# The seed pins a timestamp because a seed must be reproducible; this stamps the
# moment it runs, because that is the truth about a live fetch. They are
# supposed to differ.
#
# BOTH COPIES STAY, ruled 2026-08-11. Deleting either does not work: the seed
# cannot source from here because this fetches live PDFs and `supabase db reset`
# has to run with no network, and this cannot source from the seed because the
# seed never reaches production. So they are kept and made to prove they agree.
# ⚠️ EDIT ONE, EDIT THE OTHER — the test names the field and the daily that
# drifted, and it is the cheapest gate in CI.
DAILIES = [
    dict(slug='wynn-daily-200-nlh-10k', name='Daily $200 NLH — $10,000 Guarantee',
         start='12:00', days=[1, 2, 3, 4], entry=162.00, fee=26.00, staff=12.00,
         guarantee=10000.00, mins=30, late=9, reentry=True,
         note='Re-entry allowed until the start of level 9 (approximately 4:30 p.m.).'),
    dict(slug='wynn-daily-240-nlh-rebuy-40k', name='Friday $240 NLH Rebuy — $40,000 Guarantee',
         start='12:00', days=[5], entry=190.00, fee=35.00, staff=15.00,
         guarantee=40000.00, mins=30, late=9, reentry=False,
         note='Re-entry is NOT allowed. Unlimited $200 rebuys at 15,000 chips or less, '
              'and one $100 add-on, until the start of level 9 (approximately 4:30 p.m.).'),
    dict(slug='wynn-daily-200-nlh-25k', name='Weekend $200 NLH — $25,000 Guarantee',
         start='12:00', days=[6, 0], entry=162.00, fee=26.00, staff=12.00,
         guarantee=25000.00, mins=30, late=11, reentry=True,
         note='Re-entry and one $100 add-on until the start of level 11 (approximately 5:30 p.m.).'),
    dict(slug='wynn-nightly-160-nlh-10k', name='Nightly $160 NLH — $10,000 Guarantee',
         start='18:00', days=[0, 1, 2, 3, 4, 5, 6], entry=130.00, fee=20.00, staff=10.00,
         guarantee=10000.00, mins=20, late=9, reentry=True,
         note='Re-entry and one $100 add-on until the start of level 9 (approximately 9:00 p.m.).'),
]
# The poster prints no date; migration 011 explains why the URL's Cloudinary
# version stamp is not used, and the PDF's own CreationDate is what stands.
DAILY_DOC_DATE = '2026-06-19'

def psql_bin():
    if os.environ.get('PSQL'):
        return os.environ['PSQL']
    for c in ('psql', '/opt/homebrew/opt/postgresql@17/bin/psql'):
        try:
            subprocess.run([c, '--version'], check=True, capture_output=True); return c
        except Exception:
            pass
    raise SystemExit('psql not found. Install it, or set PSQL to its full path.')

def sql(db, q):
    r = subprocess.run([psql_bin(), db, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', q],
                       capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f'SQL FAILED:\n{r.stderr.strip()[:900]}')
    return r.stdout.strip()

FETCHED = "timestamptz '{}'".format(
    datetime.datetime.now().astimezone().replace(microsecond=0).isoformat())

def run_sql_file(db, text):
    """One psql invocation = one session = one transaction. Via a file, because
       659 levels of VALUES is past what belongs on a command line."""
    import tempfile
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f:
        f.write(text); path = f.name
    try:
        r = subprocess.run([psql_bin(), db, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-f', path],
                           capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(f'WRITE FAILED — nothing was committed:\n{r.stderr.strip()[:1200]}')
        return r.stdout
    finally:
        os.unlink(path)

def preflight(db):
    """⚠️ THE ROOM MUST EXIST, asked before anything is written.

    Every insert here is `insert ... select ... from rooms where slug = ...`.
    If the room is absent that SELECT returns no rows, so the INSERT writes
    nothing, succeeds, and reports no error — and the run goes on to claim it
    wrote 22 templates and 659 levels. That is exactly how a fresh unseeded
    database produced 'sheets replaced 22 · levels written 659' followed by a
    read-back of zero. A missing precondition must be a stopped run, not a
    cheerful one."""
    n = int(sql(db, "select count(*) from rooms where slug = 'wynn-encore'") or 0)
    if n != 1:
        raise SystemExit(
            f"refusing to run: rooms has {n} rows for slug 'wynn-encore'.\n"
            "  Every write here hangs off that row, and without it the inserts\n"
            "  would silently write nothing while reporting success.")

def apply(db, sheets, instances, dry):
    stats = dict(sources=0, series=0, dailies=0, templates=0, sheets_replaced=0,
                 sheets_unchanged=0, levels=0, instances=0, refused=[])
    preflight(db)
    stmts = []

    for url, label in ((SCHED, 'Wynn Signature Series — schedule (PDF)'),
                       (STRUCT, 'Wynn Signature Series — structures (PDF)'),
                       (POSTER, 'Wynn — daily tournament poster (PDF)'),
                       (DAILY_STRUCT, 'Wynn — all daily structures (PDF)')):
        stmts.append(f"""insert into sources (data_type, url, label, cadence_hours, status,
                                     last_fetched_at, last_ok_at)
                values ('tournaments', {Q(url)}, {Q(label)}, 168, 'ok', now(), now())
                on conflict (url, data_type) do nothing;""")
        stats['sources'] += 1

    # ── THE DAILIES. Same path to prod as everything else, which is the whole
    #    point: they were in seed.sql and seed.sql does not reach production.
    for d in DAILIES:
        days = 'array[' + ','.join(str(x) for x in d['days']) + ']::smallint[]'
        stmts.append(f"""insert into tournament_templates (
                  room_id, slug, name, game, start_time, days_of_week,
                  entry_amount, fee_amount, staff_amount, guarantee_amount,
                  starting_stack, level_minutes, late_reg_level, reentry_allowed, reentry_note,
                  structure_pdf_url, structure_fetched_at,
                  document_effective_on, document_date_source, source_url, fetched_at)
                select r.id, {Q(d['slug'])}, {Q(d['name'])}, 'nlh'::game_kind,
                       time '{d['start']}', {days},
                       {d['entry']}, {d['fee']}, {d['staff']}, {d['guarantee']},
                       25000, {d['mins']}, {d['late']}, {str(d['reentry']).lower()}, {Q(d['note'])},
                       {Q(DAILY_STRUCT)}, {FETCHED},
                       date '{DAILY_DOC_DATE}', 'pdf_created', {Q(POSTER)}, {FETCHED}
                  from rooms r where r.slug = 'wynn-encore'
                on conflict (slug) do nothing;""")
        stats['dailies'] += 1

    stmts.append(f"""insert into tournament_series (room_id, slug, name, starts_on, ends_on,
              document_effective_on, document_date_source, source_url, fetched_at)
            select r.id, 'wynn-signature-series-2026', 'Wynn Signature Series',
                   date '2026-08-17', date '2026-09-07', date '2026-08-17', 'printed',
                   {Q(SCHED)}, {FETCHED}
              from rooms r where r.slug = 'wynn-encore'
            on conflict (slug) do nothing;""")
    stats['series'] = 1

    for s_ in sheets:
        hours = sorted({i['hour'] for i in instances if i['slug'] == s_['slug']})
        stmts.append(f"""insert into tournament_templates (
                  room_id, series_id, slug, name, game, start_time, days_of_week,
                  entry_amount, fee_amount, staff_amount, guarantee_amount,
                  level_minutes, late_reg_level, reentry_allowed,
                  structure_pdf_url, structure_fetched_at,
                  document_effective_on, document_date_source, source_url, fetched_at)
                select r.id, ts.id, {Q(s_['slug'])}, {Q(s_['name'] + ' $' + str(s_['total']))},
                       {Q(GAME(s_['name']))}::game_kind, time '{hours[0]:02d}:00', null,
                       {s_['prize']}, {s_['fee']}, {s_['staff']},
                       {s_['guarantee'] if s_['guarantee'] else 'null'},
                       {s_['minutes']}, {s_['late']}, true,
                       {Q(STRUCT)}, {FETCHED}, date '2026-08-17', 'printed', {Q(SCHED)}, {FETCHED}
                  from rooms r, tournament_series ts
                 where r.slug = 'wynn-encore' and ts.slug = 'wynn-signature-series-2026'
                on conflict (slug) do nothing;""")
        stats['templates'] += 1

        # ── PRECEDENCE, read before the transaction is built. A web-sourced
        #    sheet may not overwrite floor-sourced levels.
        floor = sql(db, f"""select count(*) from tournament_templates t
                             where t.slug = {Q(s_['slug'])} and t.verified_at is not null""")
        if floor and int(floor) > 0:
            stats['refused'].append(f"{s_['slug']}: levels are floor-verified; a web sheet "
                                    f"may not overwrite them")
            continue

        # ── IDEMPOTENT BY CONTENT. Unchanged sheet: no write, no log.
        want = s_['hash']
        have = sql(db, f"""
            select coalesce(md5(string_agg(x, ',' order by x)), '') from (
              select l.level_number || ':' || l.game_type || ':' || l.small_blind || ':' ||
                     l.big_blind || ':' || l.ante || ':' || coalesce(l.small_bet::text,'') || ':' ||
                     coalesce(l.big_bet::text,'') as x
                from tournament_levels l join tournament_templates t on t.id = l.template_id
               where t.slug = {Q(s_['slug'])}) z""")
        stored = sql(db, f"""select coalesce(structure_hash,'') from
                             tournament_templates where slug = {Q(s_['slug'])}""")
        if stored == want and have:
            stats['sheets_unchanged'] += 1
            continue

        vals = ','.join(
            f"({l['level_number']},{Q(l['game_type'])},{l['small_blind']},{l['big_blind']},"
            f"{l['ante']},{s_['minutes']},"
            # null::integer, because an untyped NULL in a VALUES list types as
            # text and the insert fails on the first main level.
            f"{l['small_bet'] if l['small_bet'] is not None else 'null'}::integer,"
            f"{l['big_bet'] if l['big_bet'] is not None else 'null'}::integer)"
            for l in s_['levels'])
        # ONE LOG ROW FOR THE SHEET — the sheet is the unit of judgement.
        stmts.append(f"""delete from tournament_levels l using tournament_templates t
                 where t.id = l.template_id and t.slug = {Q(s_['slug'])};
                insert into tournament_levels (template_id, level_number, game_type, small_blind,
                                               big_blind, ante, minutes, small_bet, big_bet)
                select t.id, v.* from tournament_templates t,
                  (values {vals}) as v(level_number, game_type, small_blind, big_blind, ante,
                                       minutes, small_bet, big_bet)
                 where t.slug = {Q(s_['slug'])};
                update tournament_templates set structure_hash = {Q(want)}
                 where slug = {Q(s_['slug'])};
                insert into change_log (target_table, target_id, room_id, operation, field,
                                        new_value, source_url, agent, applied_by)
                select 'tournament_levels', t.id, t.room_id, 'update', null,
                       jsonb_build_object('sheet', {Q(s_['slug'])}, 'levels', {len(s_['levels'])},
                                          'hash', {Q(want)}),
                       {Q(STRUCT)}, 'ingest-tournaments', 'ingest-tournaments'
                  from tournament_templates t where t.slug = {Q(s_['slug'])};""")
        stats['sheets_replaced'] += 1
        stats['levels'] += len(s_['levels'])

    for i in instances:
        stmts.append(f"""insert into tournament_instances (template_id, starts_at, entry_kind)
                select id, timestamptz '{i['date']} {i['hour']:02d}:00:00{VEGAS_TZ}', {Q(i['kind'])}
                  from tournament_templates where slug = {Q(i['slug'])}
                on conflict (template_id, starts_at) do update set entry_kind = excluded.entry_kind;""")
        stats['instances'] += 1

    def census():
        """Counts read from the TARGET. Never from the parse — reporting what a
           run meant to write, as though it were what is there, is the defect
           that let a database holding nothing report 659 levels."""
        for k, q in (('templates', "select count(*) from tournament_templates "
                                   "where series_id is not null"),
                     ('dailies',   "select count(*) from tournament_templates "
                                   "where series_id is null"),
                     ('levels',    "select count(*) from tournament_levels"),
                     ('instances', "select count(*) from tournament_instances")):
            stats[k] = int(sql(db, q) or 0)

    if dry:
        # A dry run reports the target AS IT STANDS, plus what would change.
        # The same read-only query the applied path uses afterwards.
        census()
        print('  DRY RUN — nothing written. The transaction was built but not run,')
        print(f'  and it would have ended with {len(CHECKS)} assertions gating its COMMIT.')
        return stats

    # ── ONE TRANSACTION. The assertions gate the COMMIT, so a run that cannot
    #    verify leaves the database exactly as it found it.
    run_sql_file(db, 'begin;\n' + '\n'.join(stmts) + '\n' + gate_sql() + '\ncommit;\n')

    census()
    return stats

# ══ THE FIDELITY ASSERTIONS — ONE DEFINITION, TWO CALL SITES ══════════
#
# These run TWICE against the target: once inside the write transaction, where
# a failure rolls the whole thing back, and once again over a fresh connection
# after commit. The list is a module constant because two copies of it would
# drift, and the copy that drifted would be the one gating the commit.
CHECKS = [
    ('templates', "select count(*) from tournament_templates where series_id is not null", 22),
    ('dailies', "select count(*) from tournament_templates where series_id is null", 4),
    ('series', "select count(*) from tournament_series", 1),
    ('instances', "select count(*) from tournament_instances", 61),
    ('levels', "select count(*) from tournament_levels", 659),
    ('continuations', "select count(*) from tournament_instances where entry_kind='continuation'", 6),
    ('flights', "select count(*) from tournament_instances where entry_kind='flight'", 18),
    ('continuation takes entry', "select count(*) from tournament_instances "
                                 "where entry_kind='continuation' and takes_entry", 0),
    ('non-contiguous level runs', """select count(*) from (
         select template_id, game_type, count(*) c, min(level_number) lo, max(level_number) hi
           from tournament_levels group by 1,2) z where z.lo<>1 or z.hi<>z.c""", 0),
    ('levels going backwards', """select count(*) from (
         select l.*, lag(small_blind) over w psb, lag(big_blind) over w pbb,
                lag(ante) over w pa from tournament_levels l
           window w as (partition by template_id, game_type order by level_number)) z
         where z.small_blind<z.psb or z.big_blind<z.pbb or z.ante<z.pa""", 0),
    ('limit/stud levels missing bets', "select count(*) from tournament_levels "
        "where game_type in ('limit','stud') and (small_bet is null or big_bet is null)", 0),
    ('main levels claiming bets', "select count(*) from tournament_levels "
        "where game_type='main' and small_bet is not null", 0),
]

def gate_sql():
    """The assertions as a DO block, so a bad write cannot reach COMMIT.

    ⚠️ THIS IS THE PART THAT WAS MISSING, and it is why prod ended up in the
    half-finished state the standing rule forbids. Verification that runs AFTER
    the data is already committed does not prevent anything — it reports. The
    gate has to be inside the transaction, where a raise means a rollback."""
    out = ['do $gate$', 'declare g bigint;', 'begin']
    for name, q, want in CHECKS:
        out.append(f"  g := ({q.strip().rstrip(';')});")
        out.append(f"  if g <> {want} then raise exception "
                   f"'fidelity gate: {name} is %, expected {want}', g; end if;")
    out += ['end $gate$;']
    return '\n'.join(out)

def verify(db):
    """The same assertions, re-read over a fresh connection after commit —
       against whatever we wrote to, not against the parse that produced it."""
    bad = 0
    for name, q, want in CHECKS:
        got = int(sql(db, q) or 0)
        ok = got == want
        bad += 0 if ok else 1
        print(f"  {'PASS' if ok else 'FAIL'}  {name}: {got}" + ('' if ok else f' (expected {want})'))
    return bad

def main():
    db = os.environ.get('DATABASE_URL')
    if not db:
        raise SystemExit('DATABASE_URL is not set. This script writes to whatever it is given, '
                         'so it will not guess.')
    dry = os.environ.get('INGEST_APPLY') != '1'
    host = re.sub(r'//[^@]*@', '//', db).split('/')[2] if '//' in db else '?'
    print(f'\n══ WYNN TOURNAMENT INGEST ══  target {host}  {"APPLY" if not dry else "dry run"}')

    print('  fetching the published documents…')
    sheets, instances = build(pages(fetch(STRUCT)), pages(fetch(SCHED)))
    print(f'  parsed {len(sheets)} structure sheets, '
          f'{sum(len(s["levels"]) for s in sheets)} levels, {len(instances)} scheduled events')

    st = apply(db, sheets, instances, dry)
    print(f"  sources {st['sources']} · series {st['series']} · "
          f"sheets replaced {st['sheets_replaced']}, unchanged {st['sheets_unchanged']}")
    # ⚠️ "in the database", not "written". These are read back from the target
    # after commit. The previous wording reported the parse's own counts and so
    # said 659 levels about a database holding none.
    print(f"  {'in the database now' if dry else 'in the database after commit'}: dailies {st['dailies']} · series templates {st['templates']} · "
          f"levels {st['levels']} · instances {st['instances']}")
    for r in st['refused']:
        print(f'  REFUSED BY PRECEDENCE: {r}')

    if dry:
        print('  (dry run — no verification, because nothing was written)\n')
        return 0

    # The second read of the same assertions, over a fresh connection. The gate
    # inside the transaction already refused to commit anything that fails
    # these; this proves it against what is actually on disk.
    print('\n  verifying by reading the target back:')
    bad = verify(db)
    if bad:
        # ⚠️ LOUD, because a non-zero exit is invisible through a pipe — the
        # first prod run was read through `| tail` and its exit code never
        # reached a shell. The banner survives what the status code does not.
        print(f'\n  ✖✖ VERIFICATION FAILED — {bad} assertion(s). EXIT 1. ✖✖')
        print('     Nothing should have committed; if these rows exist, say so loudly.\n')
        return 1
    print('\n  ✓ all assertions pass against the target. EXIT 0.\n')
    return 0

if __name__ == '__main__':
    sys.exit(main())
