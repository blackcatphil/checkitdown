#!/usr/bin/env node
/**
 * DOES PRODUCTION HOLD WHAT THE SEED SAYS IT DOES?
 *
 * ═══ THE GAP THIS CLOSES ═══
 *
 * seed.sql ends with a self-check asserting its own row counts, and that check
 * has caught real drift several times. But it only ever runs against the
 * database the SEED just built — CI's throwaway one, or a local reset. Nothing
 * has ever asked production the same question.
 *
 * So on 2026-08-10 the Wynn tournaments shipped into seed.sql, passed every
 * gate, and reached production as ZERO ROWS. CI was green because CI reseeds;
 * local was right because local reseeds; /tournaments on checkitdown.com was
 * empty and nothing said so. Seed-only data had no path to prod and no gate
 * that noticed.
 *
 * This asks production for the seed's own tuple. It is deliberately the SAME
 * numbers the seed asserts, parsed out of seed.sql rather than copied, because
 * two hand-maintained lists of counts drift and then the check is about the
 * lists rather than the data.
 *
 * IT DOES NOT WRITE ANYTHING. A read-only URL is enough.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { resolvePsql } from './psql-path.mjs'
import { prodTarget } from './db-target.mjs'

const PSQL = resolvePsql()
/* PROD_DATABASE_URL, not DATABASE_URL. This compares PRODUCTION to the seed, so
   pointing it at local would produce a census of the wrong database that reads
   exactly like a census of the right one. `DATABASE_URL` means local now. */
const DB = prodTarget('prod-census')
const sql = (q) => execFileSync(PSQL, [DB, '-qtAX', '-c', q], { encoding: 'utf8' }).trim()

/* THE EXPECTED TUPLE IS PARSED FROM seed.sql, not restated here. */
const seed = readFileSync('supabase/seed.sql', 'utf8')
const m = seed.match(/is distinct from \(([^)]*)\) then/)
if (!m) {
  console.error('could not find the seed self-check tuple in supabase/seed.sql')
  process.exit(1)
}
const expected = m[1].split(',').map((x) => Number(x.trim()))
const LABELS = ['rooms', 'cash_games', 'game-verified', 'rake-verified', 'sources', 'waitlist', 'formats']
const QUERIES = [
  'select count(*) from rooms',
  'select count(*) from cash_games',
  'select count(*) from cash_games where verified_at is not null',
  'select count(*) from cash_games where rake_verified_at is not null',
  'select count(*) from sources',
  'select count(*) from room_waitlist',
  'select count(*) from room_formats',
]

/* AND THE TABLES THE TUPLE DOES NOT COVER. The tuple predates tournaments, and
   a census that omits the thing that just went missing is a census that would
   miss it again. Counted from the seed's own assertions so these stay honest
   too. */
const EXTRA = [
  ['tournament_templates', 26],
  ['tournament_series', 1],
  ['tournament_instances', 61],
  ['tournament_levels', 659],
]

/* DECLARED DIVERGENCES — reported, never silently exempt.
 *
 * A census that reports a known difference as a failure every morning is a
 * census somebody turns off, and then it stops catching the unknown ones. So a
 * difference that is a RULING rather than a defect is listed here with its
 * reason, printed on every run, and does not fail the check.
 *
 * The bar for this list is that the difference is intended and someone decided
 * it. "We have not got round to it" does not go here — that is drift. */
const DECLARED = [
  ['room_descriptions',
   'content arrives through the queue, not the seed (2026-08-09 ruling) — prod ' +
   'holds the 4 partner reviews and 13 approved descriptions; the seed ships none'],
]

let bad = 0
const host = DB.includes('@') ? DB.split('@')[1].split('/')[0] : 'local'
console.log(`\n══ PROD CENSUS ══  ${host}\n`)
console.log('  seed self-check tuple:')
for (let i = 0; i < LABELS.length; i++) {
  const got = Number(sql(QUERIES[i]))
  const ok = got === expected[i]
  if (!ok) bad++
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${LABELS[i].padEnd(16)} ${String(got).padStart(5)}` +
    (ok ? '' : `   seed says ${expected[i]}`))
}
console.log('\n  tables the tuple does not cover:')
for (const [table, want] of EXTRA) {
  const got = Number(sql(`select count(*) from ${table}`))
  const ok = got === want
  if (!ok) bad++
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${table.padEnd(22)} ${String(got).padStart(5)}` +
    (ok ? '' : `   seed builds ${want}`))
}

console.log('\n  declared divergences (reported, not failed):')
for (const [table, why] of DECLARED) {
  console.log(`    INFO  ${table.padEnd(22)} ${String(sql(`select count(*) from ${table}`)).padStart(5)}   ${why}`)
}

if (bad) {
  console.log(`\n✖ ${bad} counts differ. Production is not what the seed describes — either a`)
  console.log('  seed-only change never shipped, or prod moved without the seed following.\n')
  process.exit(1)
}
console.log('\n  production matches the seed.\n')
