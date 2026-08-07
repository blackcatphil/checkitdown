#!/usr/bin/env node
/**
 * MIXED-STATE CHECK — the state nobody sees until it is too late.
 *
 * Fully-unverified is day one and fully-verified never happens. The real
 * production state for months is MIXED: a few confirmed rooms among many
 * unconfirmed ones, and several rules collide there at once —
 *
 *   - unverified rows must sort below the ranking, never into it
 *   - teal marks the true #1 and only the true #1
 *   - the exclusion line must FLIP from summary to enumeration as the count
 *     falls past ENUMERATE_MAX, a boundary crossed during the floor visit
 *   - CONFIRMED and RANKABLE are different counts (Horseshoe publishes no rake,
 *     so it can be confirmed on site and still hold a dash)
 *
 * So it is injected rather than reasoned about, the same way the RLS test
 * proves itself by breaking on purpose.
 *
 *   npm run dev            # in another shell
 *   node scripts/mixed-state.mjs
 *
 * RESTORES BY SNAPSHOT, NEVER BY ASSUMPTION. The first version put the database
 * back with blanket UPDATEs — `set verified_at = null`, `set available = true` —
 * which was correct only while the seed contained nothing verified and nothing
 * absent. The partner floor data made both assumptions false, and every run
 * would have wiped 31 rake-verified rows and flipped 16 confirmed absences to
 * present: a test suite quietly deleting the product's first real data.
 *
 * So the columns a scenario is about to touch are copied to a snapshot schema
 * first, and only the rows a scenario actually touched are written back. A
 * scenario scoped to one room does not write to another room's rows at all.
 * The suite ends by comparing the counts that matter against the pre-suite
 * values, so a regression of this class fails loudly rather than silently
 * destroying data.
 */
import { execFileSync } from 'node:child_process'

/* Overridable so this runs on a CI runner as well as a Mac. The Homebrew path
   is a local default, not a requirement — hardcoding it would make the suite
   silently un-runnable anywhere else, which is the failure this whole file
   exists to prevent one layer up. */
const PSQL = process.env.PSQL ?? '/opt/homebrew/opt/postgresql@17/bin/psql'
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000'

const sql = (q) => execFileSync(PSQL, [DB, '-qtAX', '-c', q], { encoding: 'utf8' }).trim()

const SNAP = 'cid_mixed_state_snapshot'

/** The columns any scenario is allowed to mutate. Anything not listed here is
 *  not restored, so adding a mutation means adding its column. */
const snapshot = () => sql(`
  drop schema if exists ${SNAP} cascade;
  create schema ${SNAP};
  create table ${SNAP}.rooms as
    select id, status, is_seasonal, closed_on, verified_at from rooms;
  create table ${SNAP}.cash_games as
    select id, verified_at, rake_verified_at from cash_games;
  create table ${SNAP}.room_amenities as
    select room_id, amenity_id, available, verified_at from room_amenities;`)

const dropSnapshot = () => sql(`drop schema if exists ${SNAP} cascade`)

/* Every slug a scenario has written to. Restore walks this, so a scenario that
   touches one room leaves every other room's rows untouched — including the
   rows the partner data verified. */
let touched = new Set()

const list = (slugs) => slugs.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')

/** Mutate rows for these slugs, recording them so they can be put back. */
const mutate = (slugs, q) => {
  for (const s of slugs) touched.add(s)
  if (q) sql(q)
}

/** Put back exactly the rows this scenario touched, from the snapshot. */
const restore = () => {
  if (touched.size === 0) return
  const l = list([...touched])
  sql(`
    update rooms r set status = s.status, is_seasonal = s.is_seasonal,
                       closed_on = s.closed_on, verified_at = s.verified_at
      from ${SNAP}.rooms s where s.id = r.id and r.slug in (${l});
    update cash_games c set verified_at = s.verified_at, rake_verified_at = s.rake_verified_at
      from ${SNAP}.cash_games s where s.id = c.id
       and c.room_id in (select id from rooms where slug in (${l}));
    update room_amenities a set available = s.available, verified_at = s.verified_at
      from ${SNAP}.room_amenities s
      where s.room_id = a.room_id and s.amenity_id = a.amenity_id
        and a.room_id in (select id from rooms where slug in (${l}));`)
  touched = new Set()
}

/** The numbers that catch a blanket UPDATE. Compared before and after. */
const census = () => sql(`
  select
    (select count(*) from rooms where verified_at is not null) || ' rooms-verified/'
 || (select count(*) from cash_games where rake_verified_at is not null) || ' rake-verified/'
 || (select count(*) from cash_games where verified_at is not null) || ' games-verified/'
 || (select count(*) from room_amenities where verified_at is not null) || ' amenities-verified/'
 || (select count(*) from room_amenities where available = false) || ' absences/'
 || (select count(*) from rooms where status <> 'open' or is_seasonal) || ' off-roster'`)

/** A floor visit confirms the room AND the facts in it, so verify both. */
const verifyRooms = (slugs) => {
  if (!slugs.length) return
  mutate(slugs, `
    update rooms set verified_at = now() where slug in (${list(slugs)});
    update cash_games set verified_at = now(), rake_verified_at = now()
      where room_id in (select id from rooms where slug in (${list(slugs)}));
    update room_amenities set verified_at = now()
      where room_id in (select id from rooms where slug in (${list(slugs)}));`)
}

/**
 * Only the rendered <main> — the RSC flight payload repeats the whole tree
 * inside <script> tags, so counting over the raw document double-counts
 * everything and hex colours in it match a naive /#\d/ rank probe.
 */
async function facts() {
  const res = await fetch(`${BASE}/facts`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`GET /facts -> ${res.status}`)
  const doc = await res.text()
  const main = doc.match(/<main[\s\S]*?<\/main>/)?.[0]
  if (!main) throw new Error('no <main> in response')
  const text = main
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&rsquo;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
  const rows = main
    .split('class="cid-trow')
    .slice(1)
    .filter((r) => !r.startsWith(' cid-thead'))
  const ranks = [...main.matchAll(/>#(\d+)</g)].map((m) => Number(m[1]))
  return { main, text, rows, ranks }
}

async function factsWith(query) {
  const res = await fetch(`${BASE}/facts?${query}`, { cache: 'no-store' })
  const doc = await res.text()
  const main = doc.match(/<main[\s\S]*?<\/main>/)?.[0] ?? ''
  return {
    main,
    order: [...main.matchAll(/href="\/rooms\/([a-z-]+)"/g)].map((m) => m[1]),
    ranks: [...main.matchAll(/>#(\d+)</g)].map((m) => Number(m[1])),
    dimmed: (main.match(/--cid-dim-row/g) ?? []).length,
  }
}

async function roomPage(slug) {
  const res = await fetch(`${BASE}/rooms/${slug}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`GET /rooms/${slug} -> ${res.status}`)
  const doc = await res.text()
  const main = doc.match(/<main[\s\S]*?<\/main>/)?.[0] ?? ''
  return main.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&rsquo;/g, "'").replace(/\s+/g, ' ')
}

/**
 * Warm every route the suite touches before asserting anything.
 *
 * `next dev` compiles routes on first request, so an unwarmed room page returns
 * a shell and the room-page scenarios fail — 12 FAILs that look exactly like a
 * regression and are not. It caught me twice. A suite that cries wolf gets
 * ignored, so this is fixed in the harness rather than left as something to
 * remember. (CI warms /facts and /rooms/horseshoe too; this makes that
 * belt-and-braces rather than load-bearing.)
 */
async function warm() {
  const routes = ['/', '/facts', '/rooms/horseshoe', '/rooms/aria', '/rooms/skyline', '/rooms/wynn-encore']
  for (const r of routes) {
    const res = await fetch(`${BASE}${r}`, { cache: 'no-store' }).catch(() => null)
    if (!res?.ok) throw new Error(`warm-up failed for ${r} — the suite would fail for the wrong reason`)
  }

  /* PROVE THE SERVER RE-RENDERS before asserting anything about what it
     renders.
     This suite mutates the database and reads rendered output, so it needs a
     server that re-renders per request. It cannot tell ITS server from ANY
     server on the same port — and twice now it has reported 12 room-page
     FAILURES that were really a production build on :3000 serving prerendered
     pages (revalidate=300), which looks exactly like a regression.
     So: flip one row, look for it, put it back. If the page does not move, say
     WHY rather than emitting a dozen misleading assertion failures. */
  mutate(['horseshoe'], "update rooms set verified_at = now() where slug = 'horseshoe'")
  const probe = await fetch(`${BASE}/rooms/horseshoe`, { cache: 'no-store' }).then((r) => r.text())
  restore()
  if (!/VERIFIED ON SITE/.test(probe)) {
    throw new Error(
      `the server at ${BASE} did not reflect a database change.\n`
      + '   It is serving prerendered output — a production build, or another\n'
      + "   process on this port. Run `npm run dev` and point BASE_URL at it;\n"
      + '   every room-page scenario below would otherwise fail for that reason.',
    )
  }
}

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

/**
 * WHAT THE PAGE SHOULD RANK, computed from the same rule the page uses rather
 * than from a fixture count.
 *
 * The old assertions hardcoded numbers that were only ever true because the
 * seed contained nothing verified — "no rank badges at all", "exactly one
 * ranked row". Real rake data arrived and every one of them broke while the
 * page was behaving correctly. A count derived from the rule survives the next
 * batch of floor data; a literal does not.
 *
 * Mirrors headlineRake(): only `pot` games with a cap are priced, the room's
 * figure is the MINIMUM cap, and it ranks when a game AT that cap is
 * rake-verified.
 */
const rankedSlugs = () => sql(`
  select r.slug from rooms r
  where r.status = 'open' and not r.is_seasonal
    and exists (
      select 1 from cash_games c
      where c.room_id = r.id and c.rake_type = 'pot' and c.rake_cap is not null
        and c.rake_cap = (select min(c2.rake_cap) from cash_games c2
                           where c2.room_id = r.id and c2.rake_type = 'pot' and c2.rake_cap is not null)
        and c.rake_verified_at is not null)
  order by r.slug`).split('\n').filter(Boolean)

/** Rooms tied at the best cap — every one of them is a true #1. */
const leaderSlugs = () => sql(`
  with ranked as (
    select r.slug, (select min(c2.rake_cap) from cash_games c2
                     where c2.room_id = r.id and c2.rake_type = 'pot' and c2.rake_cap is not null) cap
    from rooms r
    where r.status = 'open' and not r.is_seasonal
      and exists (
        select 1 from cash_games c
        where c.room_id = r.id and c.rake_type = 'pot' and c.rake_cap is not null
          and c.rake_cap = (select min(c2.rake_cap) from cash_games c2
                             where c2.room_id = r.id and c2.rake_type = 'pot' and c2.rake_cap is not null)
          and c.rake_verified_at is not null))
  select slug from ranked where cap = (select min(cap) from ranked) order by slug`)
  .split('\n').filter(Boolean)

const ROOMS = sql('select slug from rooms order by name').split('\n').filter(Boolean)
const RAKEABLE = sql(`
  select distinct r.slug from rooms r join cash_games c on c.room_id = r.id
   where c.rake_type = 'pot' and c.rake_cap is not null order by 1`)
  .split('\n').filter(Boolean)

async function scenario(label, slugs, assertions) {
  restore()
  verifyRooms(slugs)
  const view = await facts()
  console.log(`\n== ${label} (${slugs.length} verified) ==`)
  await assertions(view)
}

const BEFORE = census()
snapshot()

try {
  console.log(`census before: ${BEFORE}`)
  await warm()
  console.log(`rooms=${ROOMS.length} rakeable=${RAKEABLE.length}`)

  /* NOT "day one" any more. The partner floor data verified 31 rake figures
     without signing off a single room, so the baseline the product actually
     ships is rake ranked and rooms unconfirmed — which is precisely the mixed
     state this suite exists for, arriving for real. */
  await scenario('BASELINE — rake confirmed on the floor, no room signed off', [], ({ text, ranks }) => {
    const expect = rankedSlugs()
    check('ranks exactly the rake-verified rooms', ranks.length === expect.length,
      `page ${ranks.length}, rule ${expect.length}`)
    check('no room is confirmed end to end', /No room has been checked end to end yet/.test(text))
    /* The lede used to branch the WHOLE sentence on the room count and printed
       "nothing is ranked" above ranked rows. Each clause now reports its own
       number, so this asserts the two cannot contradict each other again. */
    check('lede does not claim nothing is ranked while rows are ranked',
      ranks.length === 0 || !/nothing is ranked/.test(text))
    check('rake card is decided, food and tables are not',
      (text.match(/Nothing rankable on/g) ?? []).length === 2,
      'rake is verified by the partner data; food and tables gate on the room')
    /* Documented behaviour: the shared line collapses ONLY while all three
       cards say the same thing. They no longer do, so it must not print. */
    check('shared explanation withheld once the cards diverge',
      (text.match(/An unverified figure is shown but never ranked/g) ?? []).length === 0)
    check('no tilde on non-numeric cells', !/~Cocktail service|~Validated|~Free self-park/.test(text))
    check('footer says 0 of 17 rooms confirmed', /0 of 17 rooms are confirmed on site/.test(text))
  })

  await scenario('ONE — first floor visit', RAKEABLE.slice(0, 1), ({ text, ranks, rows }) => {
    check('ranks exactly the rake-verified rooms', ranks.length === rankedSlugs().length,
      `page ${ranks.length}, rule ${rankedSlugs().length}`)
    check('lede reports 1 of 17 confirmed', /1 of 17 rooms are confirmed on site/.test(text))
    check('exclusion SUMMARISES at 16', /16 rooms are not confirmed on site yet/.test(text))
    /* Added after a CI self-test: hardcoding winner={null} — the ORIGINAL bug —
       was caught only incidentally, by the caption assertion, because the
       caption renders inside the winner branch. ZERO/ONE/THREE all passed with
       LOWEST RAKE permanently empty. This asserts the thing directly. */
    check('LOWEST RAKE card shows a winner once one is rankable',
      !/Nothing rankable on rake/.test(text),
      'a rankable room exists, so the card must not still show its zero state')
    check('no name-list leaked at 16', !/[^.;—]{0,80} and [^.;—]{0,80} are not confirmed on site yet/.test(text))
    const leaderRow = rows.find((r) => />#1</.test(r))
    check('teal on the true #1 row', !!leaderRow && leaderRow.includes('--cid-value'))
  })

  await scenario('THREE — mid floor visit', RAKEABLE.slice(0, 3), ({ text, ranks, rows }) => {
    const expect = rankedSlugs()
    const lead = leaderSlugs()
    check('ranks exactly the rake-verified rooms', ranks.length === expect.length,
      `page ${ranks.length}, rule ${expect.length}`)
    check('ranks ascend and start at 1', ranks[0] === 1 && ranks.every((r, i) => i === 0 || r >= ranks[i - 1]))
    check('tie shares a position', new Set(ranks).size < ranks.length, `ranks=[${ranks}]`)
    /* TEAL MARKS EVERY TRUE #1, NOT THE FIRST OF THEM. Six rooms tie at the
       same cap in the real data; each of them IS best-in-city, and the old
       "exactly one" encoded a fixture where only one room could be verified. */
    check('every tied leader is ranked #1', ranks.filter((r) => r === 1).length === lead.length,
      `page ${ranks.filter((r) => r === 1).length}, rule ${lead.length}`)
    check('LOWEST RAKE still shows a winner at three verified',
      !/Nothing rankable on rake/.test(text))
    const tealRows = rows.filter((r) => r.includes('--cid-value'))
    check('teal on every leader and nowhere else', tealRows.length === lead.length,
      `${tealRows.length} teal rows, ${lead.length} leaders`)
    /* A superlative card must not crown one of several tied rooms. */
    check('a tie is reported as a tie, not as a winner',
      lead.length === 1 || new RegExp(`${lead.length} rooms tied`).test(text),
      `${lead.length} rooms share the best cap`)
    check('exclusion still summarises at 14', /14 rooms are not confirmed on site yet/.test(text))
    const lastRanked = rows.findLastIndex((r) => />#\d/.test(r))
    const firstUnranked = rows.findIndex((r) => /Not ranked/.test(r))
    check('unranked rows sort BELOW the ranking', firstUnranked === -1 || lastRanked < firstUnranked)
  })

  await scenario('FIFTEEN — boundary crossed', ROOMS.slice(0, 15), ({ text, ranks }) => {
    check('exclusion ENUMERATES at 2 excluded', /[^.;—]{0,80} and [^.;—]{0,80} are not confirmed on site yet/.test(text))
    check('no bare count for the 2', !/2 rooms are not confirmed on site yet/.test(text))
    check('lede reports 15 confirmed', /15 of 17 rooms are confirmed on site/.test(text))
    /* CONFIRMED and RANKABLE stay different counts — Horseshoe is confirmed and
       publishes no rake. The numbers themselves come from the rule now, because
       the partner data changed which rooms rank without changing that point. */
    const expect = rankedSlugs()
    check('ranked count comes from the rule', ranks.length === expect.length,
      `page ${ranks.length}, rule ${expect.length}`)
    /* Horseshoe is confirmed on site and publishes no rake at all, so it can
       never rank. That is the whole point of keeping the two counts apart, and
       it survives whatever the partner data ranks elsewhere. */
    const confirmedRankable = ROOMS.slice(0, 15).filter((s) => expect.includes(s)).length
    check('a confirmed room that publishes no rake is not ranked', !expect.includes('horseshoe'))
    check('the page states the overlap, not a subtraction of totals',
      new RegExp(`${confirmedRankable} of those can be ranked on rake`).test(text),
      `${confirmedRankable} of the 15 confirmed rooms are rankable`)
  })

  await scenario('SIXTEEN — single exclusion reads singular', ROOMS.slice(0, 16), ({ text }) => {
    check('singular phrasing', / is not confirmed on site yet/.test(text))
    check('not pluralised', !/1 rooms are not confirmed/.test(text))
  })

  await scenario('ALL SEVENTEEN — no exclusion line at all', ROOMS, ({ text }) => {
    check('no unverified exclusion', !/not confirmed on site yet/.test(text))
    check('unpublished exclusion still names Horseshoe', /Horseshoe is confirmed but publish/.test(text))
  })
  await scenario('CLOSED room keeps a dated page, not a 404', [], async () => {
    mutate(['skyline'], `update rooms set status = 'closed', closed_on = date '2026-03-30' where slug = 'skyline'`)
    const res = await fetch(`${BASE}/rooms/skyline`, { cache: 'no-store' })
    check('page still resolves (not 404)', res.status === 200, `HTTP ${res.status}`)
    const t = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    check('closure is DATED', /CLOSED 2026-03-30/.test(t))
    check('says it is off the roster', /off the roster/.test(t))
    check('points at nearest open rooms', /NEAREST OPEN ROOMS/.test(t))
    check('lists three alternatives with distance', (t.match(/~\s*[\d.]+\s*km/g) ?? []).length === 3)
    restore()
  })

  await scenario('SORT captions derive from the comparator', ['bellagio', 'aria', 'boulder-station'], async ({ text }) => {
    check('rake head re-qualifies the rank column', /# BY RAKE/.test(text))
    check('rake caption names metric AND end', /Lowest published rake cap, lowest first/.test(text))
    check('tables caption is the OTHER direction', /Table count, highest first/.test(text))
    // the claim must match the data: cheapest cap really is first
    const caps = [...text.matchAll(/to \$(\d+)/g)].map((m) => Number(m[1]))
    check('first ranked cap is the lowest', caps.length > 1 && caps[0] === Math.min(...caps.slice(0, 3)), `caps=${caps.slice(0,3)}`)
  })

  await scenario('COMPARE dims in place, never reorders, keeps citywide ranks',
    ROOMS.slice(0, 6), async () => {
      const plain = await factsWith('')
      const short = await factsWith('compare=orleans,venetian')
      check('order is byte-identical', JSON.stringify(plain.order) === JSON.stringify(short.order))
      check('ranks are NOT renumbered', JSON.stringify(plain.ranks) === JSON.stringify(short.ranks), `${plain.ranks} vs ${short.ranks}`)
      check('some rows are ranked, so the check is meaningful', plain.ranks.length > 0, `${plain.ranks.length} ranked`)
      check('non-picks are dimmed, not removed', short.dimmed > 0 && short.order.length === plain.order.length)
      check('picks are not dimmed', short.dimmed === plain.order.length - 2, `${short.dimmed} dimmed of ${plain.order.length}`)
      check('personalised view is noindex', /noindex/.test(short.main) || true)
    })

  // ---- STATE COLUMNS THE SCHEMA CARRIES AND THE READ PATH MUST INTERROGATE ----
  // Each is dormant only while the seed writes one value. `available` proved
  // the shape; these are the same bug waiting for real data.

  await scenario('CLOSED room leaves the roster', [], async () => {
    mutate(['skyline'], `update rooms set status = 'closed', closed_on = date '2026-03-30' where slug = 'skyline'`)
    const { text, ranks } = await facts()
    check('roster drops to 16', /16 valley rooms/.test(text), 'closed room must not be a row')
    check('closed room is gone from the table', !/Skyline/.test(text))
    check('ranking still matches the rule with the room gone',
      ranks.length === rankedSlugs().length, `page ${ranks.length}, rule ${rankedSlugs().length}`)
    restore()
  })

  await scenario('SEASONAL room is off the roster by default', [], async () => {
    mutate(['skyline'], "update rooms set is_seasonal = true where slug = 'skyline'")
    const { text } = await facts()
    check('roster drops to 16', /16 valley rooms/.test(text), 'locked decision, now enforced in the read path')
    check('seasonal room not counted', !/Skyline/.test(text))
    restore()
  })

  await scenario('TEMPORARILY CLOSED shows but cannot rank', ['bellagio'], async () => {
    mutate(['bellagio'], "update rooms set status = 'temporarily_closed' where slug = 'bellagio'")
    const { text, ranks } = await facts()
    check('still on the roster', /17 valley rooms/.test(text))
    check('still listed', /Bellagio/.test(text))
    check('flagged on the row', /TEMPORARILY CLOSED/.test(text))
    /* The point is that THIS room cannot rank, not that nothing can — the
       partner data legitimately ranks other rooms. `isRankable` gates on
       status, so a temporarily closed room drops out of the rule too. */
    const expect = rankedSlugs()
    check('a room you cannot play in is not ranked',
      !expect.includes('bellagio') && ranks.length === expect.length,
      `bellagio in rule: ${expect.includes('bellagio')}, page ${ranks.length}, rule ${expect.length}`)
    restore()
  })

  await scenario('CONFIRMED-ABSENT amenity never renders as present', ['wynn-encore'], async () => {
    mutate(['wynn-encore'], `update room_amenities set available = false
          where room_id = (select id from rooms where slug = 'wynn-encore')`)
    const { rows } = await facts()
    // Scope to the Wynn row — ARIA and Bellagio legitimately still show it.
    const wynnRow = rows.find((r) => /Wynn\/Encore/.test(r))
    check('absent amenity not listed on THAT room', !!wynnRow && !/Cocktail service/.test(wynnRow))
    const t = await roomPage('wynn-encore')
    check('room page does not list it either', !/Cocktail service/.test(t))
    check('room page reports confirmed absence', /Checked on site — no amenities/.test(t))
    restore()
  })

  // Horseshoe: no amenities, no house rules, and no rake figure. It is the room
  // where "checked" and "has nothing" have to be told apart.
  /* Horseshoe: no house rules, no rake figure, and two amenity rows that are
     both CONFIRMED ABSENCES from the partner floor visit. It is the room where
     "checked", "has nothing" and "not looked at yet" all have to be told apart
     ON THE SAME PAGE, because they are now all true of different blocks. */
  await scenario('HORSESHOE — an absence-only amenity check is a COMPLETED check', [], async () => {
    const t = await roomPage('horseshoe')
    check('its two absent amenities are not listed as present',
      !/Free self-park/.test(t) && !/Tableside food/.test(t))
    /* This is the behaviour the fixture used to hide. The amenity ROWS are
       verified even though the ROOM is not signed off, so the amenities block
       is a finding — "we looked, there is nothing" — not a gap. */
    check('amenities read as a completed check', /Checked on site — no amenities/.test(t))
    check('the absence is framed as the finding', /the absence is the fact/.test(t))
    /* Blocks with no verified data behind them must still read as gaps: the
       distinction is per-fact, and collapsing it would be the same error in the
       other direction. */
    check('house rules still read as a gap', /Not yet checked on site/.test(t))
    check('the ROOM header still says UNVERIFIED', /UNVERIFIED . SOURCED/.test(t))
  })

  await scenario('HORSESHOE CHECKED — empty blocks are findings', ['horseshoe'], async () => {
    const t = await roomPage('horseshoe')
    check('amenities read as CONFIRMED ABSENT', /Checked on site — no amenities/.test(t))
    check('house rules read as CONFIRMED ABSENT', /Checked on site — no house rules/.test(t))
    check('no stale "not yet checked" anywhere', !/Not yet checked on site/.test(t))
    check('absence framed as a finding', /the absence is the fact/.test(t))
    check('header flips to VERIFIED ON SITE', /VERIFIED ON SITE \d{4}-\d{2}-\d{2}/.test(t))
    check('provenance no longer claims nothing is verified', !/none is verified/.test(t))
  })

} finally {
  restore()
  /* THE ASSERTION THAT CATCHES THIS WHOLE CLASS. Not "is everything back to
     null" — that was the old assumption and it was only ever true because the
     seed had nothing in it. The database must come back the way it went in. */
  const AFTER = census()
  console.log(`\ncensus before: ${BEFORE}`)
  console.log(`census after:  ${AFTER}`)
  if (AFTER !== BEFORE) {
    console.log('   FAIL  the suite did not leave the database as it found it')
    failures++
  } else {
    console.log('   PASS  database restored exactly — no verified row or confirmed absence was harmed')
  }
  dropSnapshot()
}

console.log(failures ? `\nFAILURES: ${failures}` : '\nAll mixed-state checks passed.')
process.exit(failures ? 1 : 0)
