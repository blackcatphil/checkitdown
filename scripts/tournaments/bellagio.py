"""
BELLAGIO — three recurring NLH tournaments, six templates.

    DATABASE_URL=... python3 scripts/tournaments/ingest.py bellagio          # dry (local)
    INGEST_TARGET=local INGEST_APPLY=1 DATABASE_URL=... \\
        python3 scripts/tournaments/ingest.py bellagio                       # local
    PROD_DATABASE_URL=... INGEST_APPLY=1 \\
        python3 scripts/tournaments/ingest.py bellagio                       # production

═══ ⚠️ THIS ROOM PUBLISHES NO DATE AT ALL ═══

No printed date, no version string, and the URL is an opaque contentstack asset
hash — nothing in `blt627f34f0dd1c3fcb` is a date and reading one out of it
would be invention, which is the case migration 011 exists for.

So the date comes from the file, and WHICH file date matters:

    CreationDate  2025-10-06      ModDate  2026-01-09

Three months apart. This uses the ModDate and records
`document_date_source = 'pdf_modified'` (migration 020) rather than
`pdf_created`, because `pdf_created` would be a false claim about provenance —
it would say the file was made on a day three months before anybody last touched
it. `pdf_modified` is an upper bound on staleness and the surface should read it
that way.

═══ ⚠️ SIX TEMPLATES, AND THE DUPLICATION IS DELIBERATE ═══

Start times differ BY DAY, and one template holds one `start_time`:

    A  $150   Mon–Fri 12 PM  and  Mon–Fri 5 PM      18 levels
    B  $200 + $50 bounties   Sat 5 PM  and  Sun 12 PM   22 levels
    C  $200 plain            Sat 12 PM and  Sun 5 PM     22 levels

That is six. The Orleans module already set this precedent — its `group()` key
includes the time, so two times have always been two templates. B and C were
compared row by row before this was written: their 22 level sets are IDENTICAL,
0 differing rows. Each pair therefore stores the same structure twice, and the
matching `structure_hash` across a pair is what keeps that visible rather than
hidden. A shared-structure table would remove the duplication and would be a new
shape invented to solve a problem nobody has yet.

═══ ⚠️ THE MANDATORY BUY-IN IS NOT THE ADVERTISED ONE ═══

The gratuity is VOLUNTARY and the room says so twice — "Bellagio Poker does not
withhold any percentage of the prize pool for Staff gratuities. There is a
voluntary Staff gratuity of $N, at registration only."

So it is not in `staff_amount`. Wynn's `staff_amount` is a mandatory charge that
feeds `total_buy_in`; putting a tip there would publish a price the room does not
charge. `advertised_as` exists for exactly this — its column comment names this
document — and carries the poster's number verbatim.

    A     entry 115 + fee 18  = 133 mandatory,  advertised_as '$150'
    B, C  entry 160 + fee 20  = 180 mandatory,  advertised_as '$200'

═══ ⚠️ TWO CONTRADICTIONS, STORED WITHOUT BEING RESOLVED ═══

Both are on the face of the room's own document. Neither is resolved here, and
neither blocks the ingest, because BOTH LIVE ENTIRELY IN THE VOLUNTARY COMPONENT
— which is not stored as a mandatory amount:

  1. A's rule 6: "$115 of $150 Buy-in will go to the prize-pool. $18 of $140
     goes to admin fees, and $17 optional staff gratuity."  $140 appears nowhere
     else in the document and reconciles with nothing. 115 + 18 = 133 mandatory
     stands on its own; the $140 is not stored.
  2. B and C give the gratuity as $20 in rule 5 and $17 in rule 7.
     160 + 20 + 20 = 200 exactly; 160 + 20 + 17 = 197. $20 is the coherent
     reading and $17 looks copied from A's rule 6. Either way the mandatory
     figures are unchanged.

Both go on the floor-visit checklist. The verbatim wording travels in
`reentry_note` so the contradiction is legible to whoever visits.

═══ WHAT IS OMITTED, AND WHY ═══

No column, so no approximation: "Tournament Surrender" at the level-6 break ·
8-handed / 9-handed tables · "payouts approximately 12.5% of field" · the
Player's Club card requirement · NRS 463.362 · the gratuity's extra 10,000
chips.

⚠️ `starting_stack` IS 10,000, NOT THE 20,000 THE DOCUMENT LEADS WITH. Rule 5:
"Players will start with 20,000 tournament chips, INCLUDING the optional Staff
Gratuity. (10,000 + 10,000)". A player who declines the tip starts with 10,000,
and the stack a mandatory buy-in gets you is 10,000.
"""
import datetime
import io
import re

from rails import FETCHED, N, NUM, Q, fetch, floor_verified, pages, sql

NAME = 'BELLAGIO'
ROOM = 'bellagio'

SCHED = ('https://assets.contentstack.io/v3/assets/bltc6ce635bc4868eb2/'
         'blt627f34f0dd1c3fcb/bellagio_poker_tournament_schedules.pdf')

SOURCES = [(SCHED, 'Bellagio — poker tournament schedules (PDF)')]

# ⚠️ EVIDENCE, NOT CONFIGURATION. The document fetched live on 2026-08-12.
# Recorded so a later run can tell "the room republished" from "our parser
# changed" without either being a guess.
DOCUMENT_SHA256 = 'c694b3d9b77af803f08fe97a2e109c01fa8fa6b3aa004dc4c4d96088938a497f'

# One printed row per level: "  2ND LEVEL 200 100 – 200"  (ante, then blinds).
# The first level prints "---" for the ante, which is a real value meaning none.
LEVEL = re.compile(r'(\d+)(?:ST|ND|RD|TH) LEVEL\s+(---|[\d,]+)\s+([\d,]+)\s*[–-]\s*([\d,]+)')


def parse_levels(text):
    """Every level row in the document, split into its three structures.

    The document prints A, then B, then C, each restarting at level 1 — so a
    row numbered 1 is where the next structure begins. Nothing here assumes how
    many levels a structure has; the counts are asserted in CHECKS instead.
    """
    out, cur = [], []
    for lv, ante, sb, bb in LEVEL.findall(text):
        lv = int(lv)
        if lv == 1 and cur:
            out.append(cur)
            cur = []
        cur.append(dict(level_number=lv,
                        ante=None if ante == '---' else N(ante),
                        small_blind=N(sb), big_blind=N(bb)))
    if cur:
        out.append(cur)
    return out


def level_values(levels, minutes):
    """VALUES rows for one structure.

    ⚠️ THE ANTE MECHANIC IS READ FROM THE DOCUMENT, NOT DEFAULTED (migration
    019). Rule 3, on all three events: "Ante will come from the Big Blind ONLY.
    Blind is posted prior to Ante." Verified against the parse as well as the
    prose — every level after the first has `ante == big_blind`, and the first
    prints no ante at all.
    """
    rows = []
    for l in levels:
        ante = 0 if l['ante'] is None else l['ante']
        mech = 'none' if ante == 0 else 'big_blind'
        rows.append(
            f"({l['level_number']},'main',{l['small_blind']},{l['big_blind']},"
            f"{ante},{Q(mech)}::ante_mechanic,{minutes},null::integer,null::integer)")
    return ','.join(rows)


def sheet_hash(levels):
    """Content identity of one structure. B and C hash IDENTICALLY, which is the
    point: the duplication across each pair is visible rather than implied."""
    import hashlib
    import json
    canon = json.dumps([[l['level_number'], l['ante'] or 0, l['small_blind'], l['big_blind']]
                        for l in sorted(levels, key=lambda r: r['level_number'])],
                       separators=(',', ':'))
    return hashlib.sha256(canon.encode()).hexdigest()[:16]


# ⚠️ THE SIX TEMPLATES, DECLARED RATHER THAN PARSED FROM THE HEADINGS.
#
# The headings are marketing lines — "$200 NLH TOURNAMENT WITH $50 BOUNTIES /
# $3,000 GUARANTEE / SATURDAYS 5 P.M. / SUNDAYS 12 P.M." — and the day/time
# pairing is carried across two lines with no delimiter. Reading the SPLIT and
# the days out of that is exactly the "re-deriving a rule about money every
# morning" risk the Wynn dailies are declared for. These were read once, by a
# person, from the numbered rules; the structures below are parsed.
#
# `structure` indexes into parse_levels()'s output: 0 = A, 1 = B, 2 = C.
EVENTS = [
    dict(slug='bellagio-1200-150-nlh', name='$150 NLH', structure=0,
         days=[1, 2, 3, 4, 5], start='12:00',
         entry=115, fee=18, advertised='$150', guarantee=2000,
         bounty=None, bounty_funding=None),
    dict(slug='bellagio-1700-150-nlh', name='$150 NLH', structure=0,
         days=[1, 2, 3, 4, 5], start='17:00',
         entry=115, fee=18, advertised='$150', guarantee=2000,
         bounty=None, bounty_funding=None),

    # ⚠️ THE BOUNTY IS CARVED OUT OF THE PRIZE POOL, NOT ADDED TO THE PRICE
    # (migration 018). Rule 7 accounts for every dollar of the $200 and rule 8
    # says the guarantee is "the TOTAL Prize Pool (including bounties)". Stored
    # `added_to_entry` this would publish $230 for an event the room sells at
    # $200.
    dict(slug='bellagio-1700-200-nlh-bounty', name='$200 NLH with $50 Bounties',
         structure=1, days=[6], start='17:00',
         entry=160, fee=20, advertised='$200', guarantee=3000,
         bounty=50, bounty_funding='from_prize_pool'),
    dict(slug='bellagio-1200-200-nlh-bounty', name='$200 NLH with $50 Bounties',
         structure=1, days=[0], start='12:00',
         entry=160, fee=20, advertised='$200', guarantee=3000,
         bounty=50, bounty_funding='from_prize_pool'),

    dict(slug='bellagio-1200-200-nlh', name='$200 NLH', structure=2,
         days=[6], start='12:00',
         entry=160, fee=20, advertised='$200', guarantee=3000,
         bounty=None, bounty_funding=None),
    dict(slug='bellagio-1700-200-nlh', name='$200 NLH', structure=2,
         days=[0], start='17:00',
         entry=160, fee=20, advertised='$200', guarantee=3000,
         bounty=None, bounty_funding=None),
]

LEVEL_MINUTES = 20
STARTING_STACK = 10000
LATE_REG_LEVEL = 7

# The room's own words, kept verbatim so the contradictions above stay legible
# to whoever visits the floor. `late_reg_level = 7` is an INTERPRETATION of
# "through the end of level 6" — the note is what was actually printed.
NOTE_A = ('Players may buy-in and re-enter through the end of level 6 (including break). '
          'Rule 6 reads "$115 of $150 Buy-in will go to the prize-pool. $18 of $140 goes to '
          'admin fees, and $17 optional staff gratuity" — the $140 appears nowhere else in '
          'the document. The $17 gratuity is voluntary and is not part of the $133 mandatory '
          'buy-in.')
NOTE_BC = ('Players may buy-in and re-enter through the end of level 6 (including break). '
           'The voluntary staff gratuity is given as $20 in rule 5 and $17 in rule 7; '
           '$160 + $20 + $20 = $200 exactly. Neither figure is part of the $180 mandatory '
           'buy-in.')


def build(db):
    raw = fetch(SCHED)
    text = '\n'.join(pages(raw))

    # ⚠️ THE DATE IS THE ModDate. See the head of this file.
    import pypdf
    md = pypdf.PdfReader(io.BytesIO(raw)).metadata or {}
    m = re.match(r'D:(\d{4})(\d{2})(\d{2})', str(md.get('/ModDate', '')))
    if not m:
        raise SystemExit(
            'this PDF has no ModDate, and Bellagio prints no date of its own.\n'
            '  Refusing rather than falling back to CreationDate: that would record\n'
            "  document_date_source = 'pdf_created' about a file whose creation date\n"
            '  was three months stale the last time anybody looked.')
    eff = f'{m.group(1)}-{m.group(2)}-{m.group(3)}'

    structures = parse_levels(text)
    if len(structures) != 3:
        raise SystemExit(f'expected 3 level structures, parsed {len(structures)} — '
                         'the document changed shape. Refusing.')

    stmts, stats = [], dict(templates=0, levels=0, refused=[],
                            document_effective_on=eff,
                            structures=[len(s) for s in structures])
    # Recorded so the duplication across each pair is a reported fact.
    hashes = [sheet_hash(s) for s in structures]
    stats['structure_hashes'] = hashes
    stats['b_and_c_identical'] = structures[1] == structures[2]

    for e in EVENTS:
        if floor_verified(db, e['slug']):
            stats['refused'].append(f"{e['slug']}: floor-verified; a web sheet may not overwrite")
            continue
        levels = structures[e['structure']]
        days = 'array[' + ','.join(str(d) for d in e['days']) + ']::smallint[]'
        note = NOTE_A if e['structure'] == 0 else NOTE_BC
        stmts.append(f"""insert into tournament_templates (
              room_id, slug, name, game, start_time, days_of_week,
              entry_amount, fee_amount, staff_amount, bounty_amount, bounty_funding,
              advertised_as, guarantee_amount, starting_stack, level_minutes,
              late_reg_level, reentry_allowed, reentry_note,
              structure_pdf_url, structure_fetched_at, structure_hash,
              document_effective_on, document_date_source, source_url, fetched_at)
            select r.id, {Q(e['slug'])}, {Q(e['name'])}, 'nlh'::game_kind,
                   time '{e['start']}', {days},
                   {e['entry']}, {e['fee']}, null, {NUM(e['bounty'])},
                   {Q(e['bounty_funding']) + '::bounty_funding' if e['bounty_funding'] else 'null'},
                   {Q(e['advertised'])}, {e['guarantee']}, {STARTING_STACK}, {LEVEL_MINUTES},
                   {LATE_REG_LEVEL}, true, {Q(note)},
                   {Q(SCHED)}, {FETCHED}, {Q(hashes[e['structure']])},
                   date '{eff}', 'pdf_modified', {Q(SCHED)}, {FETCHED}
              from rooms r where r.slug = {Q(ROOM)}
            on conflict (slug) do nothing;""")
        stats['templates'] += 1

        stmts.append(f"""delete from tournament_levels l using tournament_templates t
             where t.id = l.template_id and t.slug = {Q(e['slug'])};
            insert into tournament_levels (template_id, level_number, game_type, small_blind,
                                           big_blind, ante, ante_mechanic, minutes, small_bet, big_bet)
            select t.id, v.* from tournament_templates t,
              (values {level_values(levels, LEVEL_MINUTES)})
                as v(level_number, game_type, small_blind, big_blind, ante,
                     ante_mechanic, minutes, small_bet, big_bet)
             where t.slug = {Q(e['slug'])};""")
        stats['levels'] += len(levels)

    stmts.append(f"""insert into change_log (target_table, target_id, room_id, operation,
                        field, new_value, source_url, agent, applied_by)
        select 'tournament_templates', null, r.id, 'insert', 'bellagio_schedule',
               jsonb_build_object('templates', {stats['templates']}, 'levels', {stats['levels']},
                                  'document', {Q(SCHED)}, 'effective_on', {Q(eff)}),
               {Q(SCHED)}, 'ingest-tournaments', 'ingest-tournaments'
          from rooms r where r.slug = {Q(ROOM)};""")

    return stmts, stats


# ⚠️ COUNTS THIS ROOM'S RUN MUST END WITH, gating the COMMIT.
#
# The ones that earn their place are the price assertions. A bounty stored
# `added_to_entry` would put $230 on a $200 event, and a voluntary gratuity in
# `staff_amount` would put $150 on a $133 one — both would be well-formed rows
# that no other check in this pipeline could see.
_B = "from tournament_templates t join rooms r on r.id = t.room_id where r.slug = 'bellagio'"
CHECKS = [
    ('bellagio templates', f'select count(*) {_B}', 6),
    ('bellagio levels', "select count(*) from tournament_levels l "
                        "join tournament_templates t on t.id = l.template_id "
                        "join rooms r on r.id = t.room_id where r.slug = 'bellagio'", 124),
    ('the two 18-level events', f"select count(*) {_B} and t.structure_hash = "
                                "(select structure_hash from tournament_templates t2 "
                                "join rooms r2 on r2.id = t2.room_id where r2.slug='bellagio' "
                                "and t2.slug='bellagio-1200-150-nlh')", 2),
    ('events carrying a bounty', f'select count(*) {_B} and t.bounty_amount is not null', 2),
    ('bounties funded from the prize pool', f"select count(*) {_B} "
                                            "and t.bounty_funding = 'from_prize_pool'", 2),
    # ⚠️ THE ASSERTION THE 018 MIGRATION EXISTS FOR. If the bounty were stored
    # added_to_entry these would be 230, and the row would look perfectly fine.
    ('bounty events priced at 180', f'select count(*) {_B} '
                                    'and t.bounty_amount is not null and t.total_buy_in = 180', 2),
    ('events claiming a staff charge', f'select count(*) {_B} and t.staff_amount is not null', 0),
    ('events priced at the advertised figure', f'select count(*) {_B} '
                                               "and t.total_buy_in in (150, 200)", 0),
    ('the $150 events priced at 133', f'select count(*) {_B} and t.total_buy_in = 133', 2),
    ('events carrying the poster figure verbatim', f'select count(*) {_B} '
                                                   'and t.advertised_as is not null', 6),
    ('events starting with 10,000 chips', f'select count(*) {_B} and t.starting_stack = 10000', 6),
    ('events dated from the file modification', f'select count(*) {_B} '
                                                "and t.document_date_source = 'pdf_modified'", 6),
    ('levels with no ante mechanic recorded', "select count(*) from tournament_levels l "
                                              "join tournament_templates t on t.id = l.template_id "
                                              "join rooms r on r.id = t.room_id "
                                              "where r.slug = 'bellagio' and l.ante_mechanic is null", 0),
    ('levels claiming a table ante', "select count(*) from tournament_levels l "
                                     "join tournament_templates t on t.id = l.template_id "
                                     "join rooms r on r.id = t.room_id "
                                     "where r.slug = 'bellagio' and l.ante_mechanic = 'table'", 0),
]
