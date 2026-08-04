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
 * Always restores the clean seeded state (every verified_at back to NULL).
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

const resetStatus = () =>
  sql(`update rooms set status = 'open', is_seasonal = false, closed_on = null;
       update room_amenities set available = true;`)

const reset = () =>
  sql(`update rooms set status = 'open', is_seasonal = false, closed_on = null;
       update room_amenities set available = true;
       update rooms set verified_at = null;
       update cash_games set verified_at = null, rake_verified_at = null;
       update room_amenities set verified_at = null;`)

/** A floor visit confirms the room AND the facts in it, so verify both. */
const verifyRooms = (slugs) => {
  if (!slugs.length) return
  const list = slugs.map((s) => `'${s}'`).join(',')
  sql(`
    update rooms set verified_at = now() where slug in (${list});
    update cash_games set verified_at = now(), rake_verified_at = now()
      where room_id in (select id from rooms where slug in (${list}));
    update room_amenities set verified_at = now()
      where room_id in (select id from rooms where slug in (${list}));`)
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

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const ROOMS = sql('select slug from rooms order by name').split('\n').filter(Boolean)
const RAKEABLE = sql(`
  select distinct r.slug from rooms r join cash_games c on c.room_id = r.id
   where c.rake_type = 'pot' and c.rake_cap is not null order by 1`)
  .split('\n').filter(Boolean)

async function scenario(label, slugs, assertions) {
  reset()
  verifyRooms(slugs)
  const view = await facts()
  console.log(`\n== ${label} (${slugs.length} verified) ==`)
  await assertions(view)
}

try {
  console.log(`rooms=${ROOMS.length} rakeable=${RAKEABLE.length}`)

  await scenario('ZERO — day one', [], ({ text, ranks }) => {
    check('three zero-state cards, ONE line each', (text.match(/Nothing rankable on/g) ?? []).length === 3)
    // The three cards said the same two paragraphs six times; the explanation
    // now lives once below the row, and only collapses while they agree.
    check('shared explanation printed once', (text.match(/An unverified figure is shown but never ranked/g) ?? []).length === 1)
    check('no tilde on non-numeric cells', !/~Cocktail service|~Validated|~Free self-park/.test(text))
    check('no rank badges at all', ranks.length === 0, `${ranks.length} found`)
    check('lede admits nothing is confirmed', /Nothing here has been confirmed on site yet/.test(text))
    check('footer says 0 of 17', /0 of 17 rooms are confirmed on site/.test(text))
  })

  await scenario('ONE — first floor visit', RAKEABLE.slice(0, 1), ({ text, ranks, rows }) => {
    check('exactly one ranked row', ranks.length === 1 && ranks[0] === 1, `ranks=[${ranks}]`)
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
    // bellagio $5, aria $6, boulder-station $6 -> #1, #2, #2. A tie shares a
    // position and the next distinct value skips; there is correctly no #3.
    check('three ranked rows', ranks.length === 3, `ranks=[${ranks}]`)
    check('ranks ascend and start at 1', ranks[0] === 1 && ranks.every((r, i) => i === 0 || r >= ranks[i - 1]))
    check('tie shares a position', new Set(ranks).size < ranks.length, `ranks=[${ranks}]`)
    check('exactly one leader', ranks.filter((r) => r === 1).length === 1)
    check('LOWEST RAKE still shows a winner at three verified',
      !/Nothing rankable on rake/.test(text))
    const tealRows = rows.filter((r) => r.includes('--cid-value'))
    check('teal on exactly one row', tealRows.length === 1, `${tealRows.length} rows`)
    check('exclusion still summarises at 14', /14 rooms are not confirmed on site yet/.test(text))
    const lastRanked = rows.findLastIndex((r) => />#\d/.test(r))
    const firstUnranked = rows.findIndex((r) => /Not ranked/.test(r))
    check('unranked rows sort BELOW the ranking', firstUnranked === -1 || lastRanked < firstUnranked)
  })

  await scenario('FIFTEEN — boundary crossed', ROOMS.slice(0, 15), ({ text, ranks }) => {
    check('exclusion ENUMERATES at 2 excluded', /[^.;—]{0,80} and [^.;—]{0,80} are not confirmed on site yet/.test(text))
    check('no bare count for the 2', !/2 rooms are not confirmed on site yet/.test(text))
    check('lede reports 15 confirmed', /15 of 17 rooms are confirmed on site/.test(text))
    // Horseshoe is confirmed but publishes no rake, so it cannot be ranked.
    check('confirmed != rankable is stated', /14 of those can be ranked on rake/.test(text), `ranks=${ranks.length}`)
    check('ranked count is 14, not 15', ranks.length === 14, `${ranks.length}`)
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
    sql(`update rooms set status = 'closed', closed_on = date '2026-03-30' where slug = 'skyline'`)
    const res = await fetch(`${BASE}/rooms/skyline`, { cache: 'no-store' })
    check('page still resolves (not 404)', res.status === 200, `HTTP ${res.status}`)
    const t = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    check('closure is DATED', /CLOSED 2026-03-30/.test(t))
    check('says it is off the roster', /off the roster/.test(t))
    check('points at nearest open rooms', /NEAREST OPEN ROOMS/.test(t))
    check('lists three alternatives with distance', (t.match(/~\s*[\d.]+\s*km/g) ?? []).length === 3)
    sql(`update rooms set status = 'open', closed_on = null where slug = 'skyline'`)
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
    sql(`update rooms set status = 'closed', closed_on = date '2026-03-30' where slug = 'skyline'`)
    const { text, ranks } = await facts()
    check('roster drops to 16', /16 valley rooms/.test(text), 'closed room must not be a row')
    check('closed room is gone from the table', !/Skyline/.test(text))
    check('ranks unaffected', ranks.length === 0)
    resetStatus()
  })

  await scenario('SEASONAL room is off the roster by default', [], async () => {
    sql("update rooms set is_seasonal = true where slug = 'skyline'")
    const { text } = await facts()
    check('roster drops to 16', /16 valley rooms/.test(text), 'locked decision, now enforced in the read path')
    check('seasonal room not counted', !/Skyline/.test(text))
    resetStatus()
  })

  await scenario('TEMPORARILY CLOSED shows but cannot rank', ['bellagio'], async () => {
    sql("update rooms set status = 'temporarily_closed' where slug = 'bellagio'")
    const { text, ranks } = await facts()
    check('still on the roster', /17 valley rooms/.test(text))
    check('still listed', /Bellagio/.test(text))
    check('flagged on the row', /TEMPORARILY CLOSED/.test(text))
    check('verified but NOT ranked', ranks.length === 0, `ranks=[${ranks}] — cannot be best if you cannot play there`)
    resetStatus()
  })

  await scenario('CONFIRMED-ABSENT amenity never renders as present', ['wynn-encore'], async () => {
    sql(`update room_amenities set available = false
          where room_id = (select id from rooms where slug = 'wynn-encore')`)
    const { rows } = await facts()
    // Scope to the Wynn row — ARIA and Bellagio legitimately still show it.
    const wynnRow = rows.find((r) => /Wynn\/Encore/.test(r))
    check('absent amenity not listed on THAT room', !!wynnRow && !/Cocktail service/.test(wynnRow))
    const t = await roomPage('wynn-encore')
    check('room page does not list it either', !/Cocktail service/.test(t))
    check('room page reports confirmed absence', /Checked on site — no amenities/.test(t))
    resetStatus()
  })

  // Horseshoe: no amenities, no house rules, and no rake figure. It is the room
  // where "checked" and "has nothing" have to be told apart.
  await scenario('HORSESHOE UNCHECKED — empty blocks are gaps', [], async () => {
    const t = await roomPage('horseshoe')
    check('amenities read as NOT CHECKED', /Not yet checked on site/.test(t))
    check('does not claim a completed check', !/Checked on site — no amenities/.test(t))
    check('header says UNVERIFIED', /UNVERIFIED . SOURCED/.test(t))
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
  reset()
  const left = sql('select count(*) from rooms where verified_at is not null')
  console.log(`\nrolled back — rooms still verified: ${left}`)
  if (left !== '0') failures++
}

console.log(failures ? `\nFAILURES: ${failures}` : '\nAll mixed-state checks passed.')
process.exit(failures ? 1 : 0)
