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

const PSQL = '/opt/homebrew/opt/postgresql@17/bin/psql'
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000'

const sql = (q) => execFileSync(PSQL, [DB, '-qtAX', '-c', q], { encoding: 'utf8' }).trim()

const reset = () =>
  sql(`update rooms set verified_at = null;
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
    check('three zero-state cards', (text.match(/No room can be ranked on/g) ?? []).length === 3)
    check('no rank badges at all', ranks.length === 0, `${ranks.length} found`)
    check('lede admits nothing is confirmed', /Nothing here has been confirmed on site yet/.test(text))
    check('footer says 0 of 17', /0 of 17 rooms are confirmed on site/.test(text))
  })

  await scenario('ONE — first floor visit', RAKEABLE.slice(0, 1), ({ text, ranks, rows }) => {
    check('exactly one ranked row', ranks.length === 1 && ranks[0] === 1, `ranks=[${ranks}]`)
    check('lede reports 1 of 17 confirmed', /1 of 17 rooms are confirmed on site/.test(text))
    check('exclusion SUMMARISES at 16', /16 rooms are not confirmed on site yet/.test(text))
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
} finally {
  reset()
  const left = sql('select count(*) from rooms where verified_at is not null')
  console.log(`\nrolled back — rooms still verified: ${left}`)
  if (left !== '0') failures++
}

console.log(failures ? `\nFAILURES: ${failures}` : '\nAll mixed-state checks passed.')
process.exit(failures ? 1 : 0)
