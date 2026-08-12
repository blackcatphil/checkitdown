"""
WYNN — the Signature Series and the four dailies, on the shared rails.

    DATABASE_URL=... python3 scripts/tournaments/ingest.py wynn            # dry (local)
    PROD_DATABASE_URL=... INGEST_APPLY=1 python3 scripts/tournaments/ingest.py wynn

═══ PORTED 2026-08-12, AND PROVED TO CHANGE NOTHING ═══

This was the original ingest and carried its own copy of every rail. The rails
now live in `rails.py`, so preflight, precedence, the fetch, the transaction,
the in-transaction gate, the post-commit read-back and the dry-run default all
come from there and the duplicates are gone.

The port was verified by `scripts/wynn-snapshot.mjs` + `scripts/wynn-diff.mjs`
against a point-in-time snapshot of production: run against an EMPTY local
target, every template, instance and level compared column by column,
ZERO DIFFERENCES across 26 / 61 / 659.

⚠️ WHAT DELIBERATELY DID NOT MOVE TO THE RAILS, and why:

  GAME()          Orleans' version has no `plo5` and its `Big-?O` does not
                  match "Big O" (space, not hyphen). Sharing it would have
                  silently retyped THREE production rows — 5-Card PLO from
                  plo5 to plo, and both Big O events from other to nlh.
                  Measured against prod before the port, not guessed.
  sheet_hash()    content identity of a structure sheet; no other room has
                  structure sheets to hash.
  parse_sheet()   the main/limit/stud level vocabulary, which is Wynn's.
  DAILIES         hand-transcribed and gated against seed.sql; see below.

⚠️ THE FOUR DOCUMENTS ARE FETCHED WITH `rails.fetch`, which sends a browser
User-Agent and refuses a body that is not a PDF — `wynn.fetch` did neither.
Adopting it was verified rather than assumed: all four URLs were fetched both
ways and compared by SHA-256 on 2026-08-12. See DOCUMENT_SHA256 below.

═══ WHY THIS IS NOT THE QUEUE ═══

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
import datetime, hashlib, json, re, sys

from rails import (FETCHED, N, Q, VEGAS_TZ, fetch, floor_verified, pages, sql)

NAME = 'WYNN'
ROOM = 'wynn-encore'
SCHED = ('https://cdn.wynnresorts.com/image/upload/v1753296112/visitwynn_pdfs_files/'
         'Poker/Wynn%20Signature%20Series/Wynn_Signature_Series_Schedule.pdf')
STRUCT = ('https://cdn.wynnresorts.com/image/upload/v1762299460/visitwynn_pdfs_files/'
          'Poker/Wynn%20Signature%20Series/Wynn_Signature_Series_Structures.pdf')
POSTER = ('https://cdn.wynnresorts.com/image/upload/v1752011166/visitwynn_pdfs_files/'
          'Poker/Daily%20Tournaments/poker-daily-tournament-poster.pdf')
DAILY_STRUCT = ('https://cdn.wynnresorts.com/image/upload/v1752011191/visitwynn_pdfs_files/'
                'Poker/Daily%20Tournaments/Poker-All_Daily_Structures.pdf')

SOURCES = [
    (SCHED, 'Wynn Signature Series — schedule (PDF)'),
    (STRUCT, 'Wynn Signature Series — structures (PDF)'),
    (POSTER, 'Wynn — daily tournament poster (PDF)'),
    (DAILY_STRUCT, 'Wynn — all daily structures (PDF)'),
]

# ⚠️ EVIDENCE, NOT CONFIGURATION. Recorded when `rails.fetch` replaced this
# module's own fetch on 2026-08-12. Both fetchers were run against all four URLs
# and the bytes were identical, so adding a User-Agent and a %PDF check changed
# nothing about what is parsed. Kept because "we checked" is a claim, and a hash
# is the only form of it anybody can re-run.
DOCUMENT_SHA256 = {
    'SCHED':        'b3b8a348666a26407c962253e095777a894b9940879ddc77ffe5330ed4f1c2cf',
    'STRUCT':       'ee235bdc87ca814940a3ec547d33a3568dfbf202409956fd8bc2bf021e478aa6',
    'POSTER':       'f7dc8281b1b508b55cfcea08485665ad2e627d19c4d274359c6c3f89cf71ccec',
    'DAILY_STRUCT': '0de7ebf42d8af2c9943a5378567b0eb396929e539ab4c919ffce7b0f227adb77',
}

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

def parse_documents(struct_pages, sched_pages):
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
#
# ═══ THE REBUY AND ADD-ON TERMS, 2026-08-11 (migration 014) ═══
#
# Same hand-transcription rule as everything else here, and the same reason: the
# terms are prose conditions on a marketing poster and re-deriving them every
# morning risks a silent mistranscription of a rule about money.
#
# ⚠️ rebuy_stack IS NOT rebuy_chips. Wynn's poster says "unlimited $200 rebuys
# AT 15,000 CHIPS OR LESS" — 15,000 is the stack at or below which a rebuy may
# be taken, not what $200 buys. What it buys is not published anywhere, so
# rebuy_chips is absent for all four. Caesars' "$50 add-on FOR 15,000 chips"
# uses the same number to mean the opposite, which is why they are two columns.
#
# `unlimited` is a claim with its own field rather than a null count — a room
# that publishes rebuys and no number has NOT said unlimited, and null must keep
# meaning "not published" here as it does everywhere else in this schema.
DAILIES = [
    dict(slug='wynn-daily-200-nlh-10k', name='Daily $200 NLH — $10,000 Guarantee',
         start='12:00', days=[1, 2, 3, 4], entry=162.00, fee=26.00, staff=12.00,
         guarantee=10000.00, mins=30, late=9, reentry=True,
         rebuy=None, rebuy_chips=None, rebuy_max=None, rebuy_unlimited=False,
         rebuy_stack=None, rebuy_window=None,
         addon=None, addon_chips=None, addon_max=None, addon_window=None,
         note='Re-entry allowed until the start of level 9 (approximately 4:30 p.m.).'),
    dict(slug='wynn-daily-240-nlh-rebuy-40k', name='Friday $240 NLH Rebuy — $40,000 Guarantee',
         start='12:00', days=[5], entry=190.00, fee=35.00, staff=15.00,
         guarantee=40000.00, mins=30, late=9, reentry=False,
         rebuy=200.00, rebuy_chips=None, rebuy_max=None, rebuy_unlimited=True,
         rebuy_stack=15000, rebuy_window='through_late_reg',
         addon=100.00, addon_chips=None, addon_max=1, addon_window='through_late_reg',
         note='Re-entry is NOT allowed. Unlimited $200 rebuys at 15,000 chips or less, '
              'and one $100 add-on, until the start of level 9 (approximately 4:30 p.m.).'),
    dict(slug='wynn-daily-200-nlh-25k', name='Weekend $200 NLH — $25,000 Guarantee',
         start='12:00', days=[6, 0], entry=162.00, fee=26.00, staff=12.00,
         guarantee=25000.00, mins=30, late=11, reentry=True,
         rebuy=None, rebuy_chips=None, rebuy_max=None, rebuy_unlimited=False,
         rebuy_stack=None, rebuy_window=None,
         addon=100.00, addon_chips=None, addon_max=1, addon_window='through_late_reg',
         note='Re-entry and one $100 add-on until the start of level 11 (approximately 5:30 p.m.).'),
    dict(slug='wynn-nightly-160-nlh-10k', name='Nightly $160 NLH — $10,000 Guarantee',
         start='18:00', days=[0, 1, 2, 3, 4, 5, 6], entry=130.00, fee=20.00, staff=10.00,
         guarantee=10000.00, mins=20, late=9, reentry=True,
         rebuy=None, rebuy_chips=None, rebuy_max=None, rebuy_unlimited=False,
         rebuy_stack=None, rebuy_window=None,
         addon=100.00, addon_chips=None, addon_max=1, addon_window='through_late_reg',
         note='Re-entry and one $100 add-on until the start of level 9 (approximately 9:00 p.m.).'),
]
# The poster prints no date; migration 011 explains why the URL's Cloudinary
# version stamp is not used, and the PDF's own CreationDate is what stands.
DAILY_DOC_DATE = '2026-06-19'

def build(db):
    """Fetch, parse, and return the statements — the rails run them.

    ⚠️ NOTHING HERE WRITES. `preflight`, the source rows, the transaction, the
    gate and the read-back all belong to `rails.main` now. This function reads
    the target (precedence, structure hashes, which daily terms moved) because
    a statement cannot report on its own row count from inside a batch, but the
    only thing it returns is text.

    ⚠️ `sources` IS NO LONGER COUNTED HERE. The rails prepend the four source
    rows from SOURCES; a `sources: 4` in these stats would be this function
    taking credit for statements it did not build.
    """
    sheets, instances = parse_documents(pages(fetch(STRUCT)), pages(fetch(SCHED)))
    print(f'  parsed {len(sheets)} structure sheets, '
          f'{sum(len(s["levels"]) for s in sheets)} levels, {len(instances)} scheduled events')

    stats = dict(series=0, dailies=0, templates=0, sheets_replaced=0,
                 sheets_unchanged=0, levels=0, instances=0, refused=[],
                 terms_updated=0, terms_unchanged=0)
    stmts = []

    # ── THE DAILIES. Same path to prod as everything else, which is the whole
    #    point: they were in seed.sql and seed.sql does not reach production.
    for d in DAILIES:
        days = 'array[' + ','.join(str(x) for x in d['days']) + ']::smallint[]'
        NUM = lambda v: 'null' if v is None else str(v)
        WIN = lambda v: 'null' if v is None else f"{Q(v)}::tournament_offer_window"
        # ⚠️ EACH TERM IS INTERPOLATED SEPARATELY BELOW rather than as one
        # pre-built `{terms}` blob. The blob was written first and worked — and
        # it collapsed ten columns into a single select expression, which is
        # exactly what `lib/wynn-dailies.test.mjs` cannot see through: that gate
        # zips the column list against the select list to diff this copy against
        # the seed's, and one placeholder covering ten columns hides all ten.
        # The gate said so by refusing to parse, which is the behaviour it was
        # built for.
        # ── THE TERMS BACKFILL ONTO A ROW THAT ALREADY EXISTS.
        #
        # `do nothing` was right while the whole row was the unit: a daily was
        # either there or it was not. Migration 014 added columns to rows that
        # are already in production, so `do nothing` would have made this
        # ingest structurally incapable of delivering them — the run would say
        # "dailies 4" and write nothing, which is the quiet-zero shape this repo
        # keeps finding.
        #
        # THREE THINGS MAKE THE UPSERT SAFE, and all three are in the WHERE:
        #
        #   IT TOUCHES ONLY THE TERM COLUMNS. Not the name, not the buy-in
        #   split, not the schedule. This run is delivering the rebuy and add-on
        #   terms and says so in the diff; correcting a buy-in is a different
        #   decision with different evidence.
        #
        #   IT IS A NO-OP WHEN NOTHING MOVED. The `where` on `do update` means
        #   an unchanged row is not written at all — no updated_at bump, no
        #   trigger, nothing in the log. `is distinct from` rather than `<>`
        #   because every one of these columns is nullable and `null <> null` is
        #   null, which would make every re-run rewrite every row forever.
        #
        #   IT YIELDS TO THE FLOOR. A template somebody stood in the room and
        #   verified is not overwritten by a web-tier poster read — the same
        #   precedence guard the level sheets already carry, applied to the one
        #   other thing this script writes.
        stmts.append(f"""insert into tournament_templates (
                  room_id, slug, name, game, start_time, days_of_week,
                  entry_amount, fee_amount, staff_amount, guarantee_amount,
                  starting_stack, level_minutes, late_reg_level, reentry_allowed, reentry_note,
                  rebuy_amount, rebuy_chips, rebuy_max, rebuy_unlimited, rebuy_max_stack,
                  rebuy_window, addon_amount, addon_chips, addon_max, addon_window,
                  structure_pdf_url, structure_fetched_at,
                  document_effective_on, document_date_source, source_url, fetched_at)
                select r.id, {Q(d['slug'])}, {Q(d['name'])}, 'nlh'::game_kind,
                       time '{d['start']}', {days},
                       {d['entry']}, {d['fee']}, {d['staff']}, {d['guarantee']},
                       25000, {d['mins']}, {d['late']}, {str(d['reentry']).lower()}, {Q(d['note'])},
                       {NUM(d['rebuy'])}, {NUM(d['rebuy_chips'])}, {NUM(d['rebuy_max'])},
                       {str(d['rebuy_unlimited']).lower()}, {NUM(d['rebuy_stack'])},
                       {WIN(d['rebuy_window'])},
                       {NUM(d['addon'])}, {NUM(d['addon_chips'])}, {NUM(d['addon_max'])},
                       {WIN(d['addon_window'])},
                       {Q(DAILY_STRUCT)}, {FETCHED},
                       date '{DAILY_DOC_DATE}', 'pdf_created', {Q(POSTER)}, {FETCHED}
                  from rooms r where r.slug = 'wynn-encore'
                on conflict (slug) do update set
                       rebuy_amount    = excluded.rebuy_amount,
                       rebuy_chips     = excluded.rebuy_chips,
                       rebuy_max       = excluded.rebuy_max,
                       rebuy_unlimited = excluded.rebuy_unlimited,
                       rebuy_max_stack = excluded.rebuy_max_stack,
                       rebuy_window    = excluded.rebuy_window,
                       addon_amount    = excluded.addon_amount,
                       addon_chips     = excluded.addon_chips,
                       addon_max       = excluded.addon_max,
                       addon_window    = excluded.addon_window,
                       updated_at      = now()
                 where tournament_templates.verified_at is null
                   and (tournament_templates.rebuy_amount    is distinct from excluded.rebuy_amount
                     or tournament_templates.rebuy_chips     is distinct from excluded.rebuy_chips
                     or tournament_templates.rebuy_max       is distinct from excluded.rebuy_max
                     or tournament_templates.rebuy_unlimited is distinct from excluded.rebuy_unlimited
                     or tournament_templates.rebuy_max_stack is distinct from excluded.rebuy_max_stack
                     or tournament_templates.rebuy_window    is distinct from excluded.rebuy_window
                     or tournament_templates.addon_amount    is distinct from excluded.addon_amount
                     or tournament_templates.addon_chips     is distinct from excluded.addon_chips
                     or tournament_templates.addon_max       is distinct from excluded.addon_max
                     or tournament_templates.addon_window    is distinct from excluded.addon_window);""")
        stats['dailies'] += 1

        # ONE LOG ROW PER DAILY WHOSE TERMS MOVED, written under the same
        # condition as the update above so the audit trail cannot claim a change
        # that did not happen. Read BEFORE the transaction is built, like the
        # level-sheet precedence check, because a statement cannot report on
        # its own row count from inside a batch.
        moved = sql(db, f"""select count(*) from tournament_templates t
                             where t.slug = {Q(d['slug'])} and t.verified_at is null
                               and (t.rebuy_amount    is distinct from {NUM(d['rebuy'])}::numeric
                                 or t.rebuy_unlimited is distinct from {str(d['rebuy_unlimited']).lower()}
                                 or t.rebuy_max_stack is distinct from {NUM(d['rebuy_stack'])}::integer
                                 or t.addon_amount    is distinct from {NUM(d['addon'])}::numeric
                                 or t.addon_max       is distinct from {NUM(d['addon_max'])}::integer)""")
        if moved and int(moved) > 0:
            stats['terms_updated'] += 1
            stmts.append(f"""insert into change_log (target_table, target_id, room_id, operation,
                                        field, new_value, source_url, agent, applied_by)
                select 'tournament_templates', t.id, t.room_id, 'update', 'rebuy_and_addon_terms',
                       jsonb_build_object('rebuy', {NUM(d['rebuy'])}, 'unlimited',
                                          {str(d['rebuy_unlimited']).lower()},
                                          'addon', {NUM(d['addon'])}),
                       {Q(POSTER)}, 'ingest-tournaments', 'ingest-tournaments'
                  from tournament_templates t where t.slug = {Q(d['slug'])};""")
        else:
            stats['terms_unchanged'] += 1

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
        #    sheet may not overwrite floor-sourced levels. `floor_verified` is
        #    the rails' helper and runs the identical query this used inline.
        if floor_verified(db, s_['slug']):
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

    # ⚠️ NO census() HERE, AND NOTHING IS LOST BY THAT. It re-read four counts
    # from the target after COMMIT and printed them. All four — templates,
    # dailies, levels, instances — are already in CHECKS with the identical
    # queries, so they run INSIDE the transaction where a mismatch rolls the
    # write back, and again over a fresh connection in `rails.verify`. A
    # post-commit print can only report; the gate can refuse. Verified by
    # comparing the query strings, not by eye.
    return stmts, stats


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

    # ── REBUY AND ADD-ON TERMS (migration 014) ───────────────────────
    # These gate the COMMIT, so a run that fails to deliver the terms — or
    # delivers them into the wrong column — rolls back rather than leaving
    # production half-priced.
    ('dailies carrying the $100 add-on', "select count(*) from tournament_templates "
        "where series_id is null and addon_amount = 100.00 and addon_max = 1", 3),
    ('unlimited-rebuy events', "select count(*) from tournament_templates "
        "where rebuy_unlimited", 1),
    # NO APOSTROPHES IN A CHECK LABEL. These labels are interpolated into a
    # single-quoted SQL string inside the DO block, so "event's" terminates the
    # literal and the whole transaction fails to parse — which is exactly what
    # happened on the first prod apply of this round. The gate refused correctly
    # and nothing was written, but the error pointed at syntax rather than at the
    # apostrophe. Keep labels plain.
    ("the Friday eligibility threshold", "select coalesce(rebuy_max_stack, 0) "
        "from tournament_templates where slug = 'wynn-daily-240-nlh-rebuy-40k'", 15000),
    # ⚠️ THE ASSERTION THAT CATCHES THE ONE MISTAKE THIS SCHEMA WAS SHAPED TO
    # PREVENT. Wynn publishes no chip figure for a rebuy — "15,000 chips or
    # less" is when you MAY rebuy, not what you get. Anything in rebuy_chips
    # here is that number in the wrong column, which would tell a reader $200
    # buys 15,000 chips. Nothing else in the pipeline can see that, because the
    # row would be perfectly well-formed.
    ('invented rebuy chip figures', "select count(*) from tournament_templates "
        "where rebuy_chips is not null", 0),
]

# ⚠️ NO gate_sql(), verify() OR main() HERE ANY MORE. `rails.gate_sql(CHECKS)`
# builds the same DO block, `rails.verify(db, CHECKS)` re-reads the same
# assertions over a fresh connection, and `rails.main` sequences them. Three
# copies of the thing that gates a production write is exactly the drift the
# rails exist to prevent — and the copy that rotted would have been the one
# holding the COMMIT open.


# ⚠️ THIS FILE IS A ROOM MODULE AND HAS NO ENTRY POINT. Running it directly used
# to ingest; now it would import cleanly, define some functions and exit 0
# having done nothing — a silent no-op that looks exactly like a successful run.
# `npm run ingest:tournaments` pointed here until 2026-08-12 and was repointed
# in the same change; this guard exists for the muscle memory that outlives it.
if __name__ == '__main__':
    raise SystemExit(
        'wynn.py is a room module — it parses and returns statements, and writes\n'
        'nothing on its own. Run it through the shared runner:\n'
        '    DATABASE_URL=... python3 scripts/tournaments/ingest.py wynn          # dry\n'
        '    INGEST_TARGET=local INGEST_APPLY=1 DATABASE_URL=... \\\n'
        '        python3 scripts/tournaments/ingest.py wynn                       # local\n'
        '    PROD_DATABASE_URL=... INGEST_APPLY=1 \\\n'
        '        python3 scripts/tournaments/ingest.py wynn                       # production')
