"""
THE ORLEANS — the live August 2026 daily schedule.

    DATABASE_URL=... python3 scripts/tournaments/ingest.py orleans          # dry
    DATABASE_URL=... INGEST_APPLY=1 python3 scripts/tournaments/ingest.py orleans

═══ ⚠️ THE ENTRY/FEE SPLIT IS NOT PUBLISHED, AND THAT IS THE POINT ═══

The schedule says, in the room's own words:

    "Consult structure sheets for details on individual events, including
     starting chips, level duration, blind levels, and entry fees."

and the structures PDF it defers to is NO LONGER LINKED from the poker room
page — the August filename 404s and only a stale March copy is still hosted.
So $150 is the entire published price of a $150 event here.

Every row therefore writes `published_buy_in` and leaves `entry_amount` and
`fee_amount` NULL, which migration 015 exists for. `fee_percent` computes to
NULL and both surfaces render UNKNOWN. Writing `fee_amount = 0` instead would
put The Orleans at the top of a fee ranking claiming it takes nothing — our own
invention, about a room that has published no claim at all.

═══ WHY THE LOCAL COPIES WERE NOT USED ═══

The March schedule on the Mac is a DIFFERENT DOCUMENT, not an older edit of this
one: the Mon–Thu 6:05 p.m. $100 add-on daily is gone entirely, Sunday's Big-O
went $150 → $200, and a Friday $200 Mega Stack and a Saturday $240 rotating
mixed game are new. Ingesting it would have published four events that no longer
run at a price no longer charged.

═══ ONE TEMPLATE PER RECURRING EVENT ═══

The schedule is printed as a day-by-day table, so "NLH AM Monster Stack, $120,
11:05" appears four times. Four rows would claim four different tournaments;
this groups identical events across days into one template with `days_of_week`,
which is the same model the Wynn dailies use and the reason that column exists.
"""
import re

from rails import FETCHED, N, NUM, Q, fetch, floor_verified, pages, sql

NAME = 'THE ORLEANS'
ROOM = 'orleans'

# The room's own page links exactly these. Re-checked 2026-08-11: the poker
# room page carries the schedule and a cash-game promotions sheet, and NO
# structures PDF — see the note at the head of this file.
SCHED = ('https://mc-d7f7cc1f-1a7c-4fc5-b531-6087-cdn-endpoint.azureedge.net/-/media/project/'
         'boyd/property/lasvegas/orleans/pdf/2026aug_to_poker_daily_schedule_ada.pdf'
         '?rev=84c701aeee834c2b829b75e9db528cd6')

SOURCES = [(SCHED, 'The Orleans — poker daily tournament schedule (PDF)')]

DAYS = {'sun': 0, 'mon': 1, 'tue': 2, 'tues': 2, 'wed': 3, 'thu': 4, 'thurs': 4,
        'fri': 5, 'sat': 6}

# ⚠️ THE "LEVELS" COLUMN IS MINUTES PER LEVEL, NOT A LEVEL COUNT — the same trap
# the Wynn schedule sets and the same answer: this room prints 20, 30 and
# "20/30", which are durations. A row whose levels CHANGE duration part-way
# ("20/30") cannot be one number, so it stores NULL rather than the first half.
ROW = re.compile(
    r'^(?:(Sun|Mon|Tues?|Wed|Thurs?|Fri|Sat)\s+)?'
    r'(\d{1,2}):(\d{2})\s*(AM|PM)\s+'
    r'(.+?)\s+'
    r'\$([\d,]+)(\*?)\s+'
    r'\$([\d,]+)\s+'
    r'([\d,]+)(\*?)\s+'
    r'(\d+(?:/\d+)?)\s+'
    r'(\d{1,2}):(\d{2})\s*(AM|PM)\s*$', re.I)

# The footnote the asterisks point at. Parsed rather than assumed, so a run
# against a schedule that changed the add-on refuses instead of carrying the old
# figure forward.
ADDON = re.compile(r'\*\s*One-time optional \$([\d,]+) add-on receives an additional ([\d,]+) chips',
                   re.I)

GAME = (lambda n: ('mixed' if re.search(r'HORSE|TORSE|\bTOE\b|Rotating Mixed|game draw', n, re.I) else
                   'other' if re.search(r'Big-?O|Omaha|Dramaha|Draw', n, re.I) else
                   'plo' if re.search(r'\bPLO\b', n, re.I) else 'nlh'))


def clock(h, m, ampm):
    h = int(h) % 12 + (12 if ampm.upper() == 'PM' else 0)
    return f'{h:02d}:{int(m):02d}'


def slugify(name, time24):
    s = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    s = re.sub(r'-ring-event-?', '-', s).strip('-')
    return f'orleans-{time24.replace(":", "")}-{s}'[:80]


def parse(text):
    """The schedule table into one dict per PRINTED ROW."""
    rows, day = [], None
    for line in text.splitlines():
        line = line.strip()
        m = ROW.match(line)
        if not m:
            continue
        if m.group(1):
            day = DAYS[m.group(1).lower()]
        if day is None:
            raise SystemExit(f'a schedule row appeared before any day heading: {line[:70]!r}')
        rows.append(dict(
            day=day,
            time=clock(m.group(2), m.group(3), m.group(4)),
            name=re.sub(r'\s*\*Ring Event\*\s*', ' ', m.group(5), flags=re.I).strip(),
            ring=bool(re.search(r'\*Ring Event\*', m.group(5), re.I)),
            buy_in=N(m.group(6)),
            starred=bool(m.group(7) or m.group(10)),
            guarantee=N(m.group(8)),
            stack=N(m.group(9)),
            minutes=None if '/' in m.group(11) else int(m.group(11)),
            minutes_raw=m.group(11),
            reg_close=clock(m.group(12), m.group(13), m.group(14)),
        ))
    return rows


def group(rows):
    """Identical events across days become ONE template with days_of_week."""
    out = {}
    for r in rows:
        key = (r['time'], r['name'], r['buy_in'], r['guarantee'], r['stack'],
               r['minutes_raw'], r['reg_close'], r['starred'])
        g = out.setdefault(key, {**r, 'days': []})
        g['days'].append(r['day'])
    for g in out.values():
        g['days'] = sorted(set(g['days']))
    return list(out.values())


def stored(db):
    """What the target already holds for this room, keyed by slug.

    Read BEFORE the transaction so the run can tell "nothing moved" from "we
    rewrote everything to the same values" — a statement cannot report on its
    own row count from inside a batch, which is the same reason the Wynn path
    reads its precedence and hash state up front.
    """
    raw = sql(db, f"""
        select t.slug || chr(9) ||
               t.name || chr(9) || t.game || chr(9) ||
               coalesce(t.days_of_week::text,'') || chr(9) ||
               coalesce(t.published_buy_in::text,'') || chr(9) ||
               coalesce(t.guarantee_amount::text,'') || chr(9) ||
               coalesce(t.starting_stack::text,'') || chr(9) ||
               coalesce(t.level_minutes::text,'') || chr(9) ||
               coalesce(t.late_reg_close::text,'') || chr(9) ||
               coalesce(t.addon_amount::text,'') || chr(9) ||
               coalesce(t.addon_chips::text,'') || chr(9) ||
               coalesce(t.addon_max::text,'') || chr(9) ||
               coalesce(t.document_effective_on::text,'')
          from tournament_templates t join rooms r on r.id = t.room_id
         where r.slug = {Q(ROOM)}""")
    out = {}
    for line in raw.splitlines():
        if not line.strip():
            continue
        parts = line.split('\t')
        out[parts[0]] = parts[1:]
    return out


def wanted(e, slug, addon_amount, addon_chips, eff):
    """The same tuple `stored()` returns, for a parsed event. Compared as TEXT
       in the shapes Postgres prints, so `120.00` and `120` cannot read as a
       difference and rewrite the row every night."""
    star = e['starred']
    return [
        e['name'], GAME(e['name']),
        '{' + ','.join(str(d) for d in e['days']) + '}',
        f"{e['buy_in']}.00",
        f"{e['guarantee']}.00",
        str(e['stack']),
        '' if e['minutes'] is None else str(e['minutes']),
        f"{e['reg_close']}:00",
        f'{addon_amount}.00' if star else '',
        str(addon_chips) if star else '',
        '1' if star else '',
        eff or '',
    ]


def build(db):
    raw = fetch(SCHED)
    text = '\n'.join(pages(raw))

    addon = ADDON.search(text)
    if not addon:
        raise SystemExit(
            'the add-on footnote is not on this schedule any more.\n'
            "  It reads '*One-time optional $100 add-on receives an additional 25,000 chips'\n"
            '  and the asterisks on the buy-in columns point at it. Refusing rather than\n'
            '  carrying the old figure forward against a document that changed.')
    addon_amount, addon_chips = N(addon.group(1)), N(addon.group(2))

    # ⚠️ THE DOCUMENT DATE. The schedule prints no date of its own, so this
    # falls to the PDF's CreationDate and says so — migration 011's rule, and
    # the same reason the Cloudinary version stamp is never used for Wynn.
    # Read here rather than after the loop because it is one of the values the
    # unchanged-check compares.
    import io
    import pypdf
    created = (pypdf.PdfReader(io.BytesIO(raw)).metadata or {}).get('/CreationDate', '')
    dm = re.match(r'D:(\d{4})(\d{2})(\d{2})', str(created))
    eff = f'{dm.group(1)}-{dm.group(2)}-{dm.group(3)}' if dm else None

    rows = parse(text)
    if not rows:
        raise SystemExit('parsed ZERO schedule rows — the table format changed. Refusing.')
    events = group(rows)

    have = stored(db)
    stmts, stats = [], dict(printed_rows=len(rows), templates=0, refused=0,
                            addon=f'${addon_amount} for {addon_chips:,} chips',
                            document_effective_on=eff)
    moved = []

    for e in events:
        slug = slugify(e['name'], e['time'])
        # PRECEDENCE, read before the transaction is built.
        if floor_verified(db, slug):
            stats['refused'] += 1
            continue
        if have.get(slug) != wanted(e, slug, addon_amount, addon_chips, eff):
            moved.append(slug)
        days = 'array[' + ','.join(str(d) for d in e['days']) + ']::smallint[]'
        # ⚠️ published_buy_in, NOT entry_amount/fee_amount. See the head of this
        # file: this room publishes a price and defers the split to a document
        # it no longer links.
        stmts.append(f"""insert into tournament_templates (
              room_id, slug, name, game, start_time, days_of_week,
              published_buy_in, guarantee_amount, starting_stack, level_minutes,
              late_reg_close, addon_amount, addon_chips, addon_max,
              document_effective_on, document_date_source, source_url, fetched_at)
            select r.id, {Q(slug)}, {Q(e['name'])}, {Q(GAME(e['name']))}::game_kind,
                   time '{e['time']}', {days},
                   {e['buy_in']}, {e['guarantee']}, {e['stack']}, {NUM(e['minutes'])},
                   time '{e['reg_close']}',
                   {NUM(addon_amount if e['starred'] else None)},
                   {NUM(addon_chips if e['starred'] else None)},
                   {NUM(1 if e['starred'] else None)},
                   {"date '" + eff + "'" if eff else 'null'},
                   {"'pdf_created'" if eff else 'null'}, {Q(SCHED)}, {FETCHED}
              from rooms r where r.slug = {Q(ROOM)}
            on conflict (slug) do update set
                   name              = excluded.name,
                   game              = excluded.game,
                   days_of_week      = excluded.days_of_week,
                   published_buy_in  = excluded.published_buy_in,
                   guarantee_amount  = excluded.guarantee_amount,
                   starting_stack    = excluded.starting_stack,
                   level_minutes     = excluded.level_minutes,
                   late_reg_close    = excluded.late_reg_close,
                   addon_amount      = excluded.addon_amount,
                   addon_chips       = excluded.addon_chips,
                   addon_max         = excluded.addon_max,
                   document_effective_on = excluded.document_effective_on,
                   document_date_source  = excluded.document_date_source,
                   fetched_at        = excluded.fetched_at,
                   updated_at        = now()
             where tournament_templates.verified_at is null
               and (tournament_templates.name             is distinct from excluded.name
                 or tournament_templates.game             is distinct from excluded.game
                 or tournament_templates.days_of_week     is distinct from excluded.days_of_week
                 or tournament_templates.published_buy_in is distinct from excluded.published_buy_in
                 or tournament_templates.guarantee_amount is distinct from excluded.guarantee_amount
                 or tournament_templates.starting_stack   is distinct from excluded.starting_stack
                 or tournament_templates.level_minutes    is distinct from excluded.level_minutes
                 or tournament_templates.late_reg_close   is distinct from excluded.late_reg_close
                 or tournament_templates.addon_amount     is distinct from excluded.addon_amount
                 or tournament_templates.document_effective_on is distinct from excluded.document_effective_on);""")
        stats['templates'] += 1

    # ⚠️ ONE LOG ROW PER RUN THAT ACTUALLY MOVED SOMETHING — and the first
    # version of this file wrote one EVERY run, which is the "a change_log entry
    # a day for prose nobody touched" failure the differ's prose branch already
    # argues against. Caught by re-running the ingest twice and watching the
    # audit trail grow against an unchanged document.
    if not moved:
        stats['unchanged'] = len(events)
        return stmts, stats
    stats['moved'] = len(moved)
    stats['unchanged'] = len(events) - len(moved)
    stmts.append(f"""insert into change_log (target_table, target_id, room_id, operation,
                        field, new_value, source_url, agent, applied_by)
        select 'tournament_templates', null, r.id, 'update', 'orleans_daily_schedule',
               jsonb_build_object('events', {len(events)}, 'printed_rows', {len(rows)},
                                  'moved', {len(moved)}, 'document', {Q(SCHED)}),
               {Q(SCHED)}, 'ingest-tournaments', 'ingest-tournaments'
          from rooms r where r.slug = {Q(ROOM)};""")

    return stmts, stats


# ⚠️ COUNTS THIS ROOM'S RUN MUST END WITH, gating the COMMIT.
#
# The two that matter most are the last two. `entry_amount is not null` catches
# somebody "helpfully" filling in a split this room does not publish, and
# `fee_percent is not null` catches the same mistake arriving through the
# generated column — either would put The Orleans in a fee ranking on a figure
# nobody published.
CHECKS = [
    ('orleans templates', "select count(*) from tournament_templates t join rooms r "
                          "on r.id = t.room_id where r.slug = 'orleans'", 16),
    ('orleans events carrying a published price', "select count(*) from tournament_templates t "
        "join rooms r on r.id = t.room_id where r.slug = 'orleans' "
        "and t.published_buy_in is not null", 16),
    ('orleans events with an invented split', "select count(*) from tournament_templates t "
        "join rooms r on r.id = t.room_id where r.slug = 'orleans' "
        "and t.entry_amount is not null", 0),
    ('orleans events claiming a fee share', "select count(*) from tournament_templates t "
        "join rooms r on r.id = t.room_id where r.slug = 'orleans' "
        "and t.fee_percent is not null", 0),
    ('orleans events with the $100 add-on', "select count(*) from tournament_templates t "
        "join rooms r on r.id = t.room_id where r.slug = 'orleans' "
        "and t.addon_amount = 100", 1),
    ('orleans events with no registration close', "select count(*) from tournament_templates t "
        "join rooms r on r.id = t.room_id where r.slug = 'orleans' "
        "and t.late_reg_close is null", 0),
]
