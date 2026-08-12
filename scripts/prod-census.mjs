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
/* ⚠️ DERIVED FROM THE SEED, NOT RETYPED. The tuple counts ALL sources; the
   query above counts only the non-tournament ones, so the expectation has to
   drop the tournament rows the seed itself inserts. Counted out of seed.sql so
   a new seeded document moves both halves together. */
/* ⚠️ COUNTS VALUES TUPLES, NOT INSERT STATEMENTS. The first version matched
   `insert into sources ... 'tournaments'` and found 2 — the seed writes its four
   tournament sources as four VALUES rows across two INSERTs, so the expectation
   came out 46 against an actual 44 and the census failed for a reason that was
   entirely mine. */
const SEEDED_TOURNAMENT_SOURCES =
  (seed.match(/\(\s*'tournaments',/g) ?? []).length
expected[4] -= SEEDED_TOURNAMENT_SOURCES
const LABELS = ['rooms', 'cash_games', 'game-verified', 'rake-verified',
  'sources (seeded)', 'waitlist', 'formats']
const QUERIES = [
  'select count(*) from rooms',
  'select count(*) from cash_games',
  'select count(*) from cash_games where verified_at is not null',
  'select count(*) from cash_games where rake_verified_at is not null',
  /* ⚠️ EXCLUDING THE ONES THE INGEST REGISTERS. The tuple says 48 and the seed
     produces exactly 48 — that number is RIGHT, and it was nearly "corrected"
     to 50 on the belief that it had been wrong since Orleans. It has not: the
     two extra rows on production are the Orleans and Bellagio schedule PDFs,
     inserted by `rails.source_rows` when each ingest ran. Raising the tuple to
     50 would have made `seed.sql` assert a count its own INSERTs cannot reach,
     so `supabase db reset` would fail on the seed's self-check — the seed
     lying about itself to make a census quiet.

     `data_type = 'tournaments'` is the exact seam: the seed ships 4 of them
     (Wynn's documents) and each ingested room adds one. So this compares the 44
     rows the seed genuinely owns and STILL FAILS if one of them goes missing,
     while the ingest-registered ones are declared below with their URLs. */
  "select count(*) from sources where data_type <> 'tournaments'",
  'select count(*) from room_waitlist',
  'select count(*) from room_formats',
]

/* AND THE TABLES THE TUPLE DOES NOT COVER. The tuple predates tournaments, and
   a census that omits the thing that just went missing is a census that would
   miss it again. Counted from the seed's own assertions so these stay honest
   too. */
const EXTRA = [
  /* ⚠️ tournament_templates AND tournament_levels HAVE MOVED TO `DECLARED`.
     They are the ingest's output, not the seed's, and asserting a seed number
     against them made this census fail every morning for a ruling nobody had
     revisited. `tournament_series` and `tournament_instances` STAY HERE: the
     seed builds both in full, no ingest has added to either, and a change in
     them would be real drift. */
  ['tournament_series', 1],
  ['tournament_instances', 61],
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
  ['tournament_templates',
   'rooms arrive through the INGEST, not the seed (2026-08-12 ruling). The seed ' +
   "builds Wynn's 26 from transcription; Orleans (16, July) and Bellagio (6) are " +
   'parsed from live PDFs that `supabase db reset` cannot fetch, so no seed number ' +
   'can ever describe this table'],
  ['tournament_levels',
   "same ruling. The seed builds Wynn's 659; Bellagio's 124 come from a live " +
   'document. A seed asserting 783 would be asserting rows it cannot produce'],
]

/* The one divergence that is a COUNT rather than a table: each ingested room
   registers its own source document. Printed with the URLs so "one more source"
   is never a number nobody can account for. */
const TOURNAMENT_SOURCES =
  "select count(*) from sources where data_type = 'tournaments'"

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
{
  const n = Number(sql(TOURNAMENT_SOURCES))
  console.log(`    INFO  ${'sources (tournaments)'.padEnd(22)} ${String(n).padStart(5)}   `
    + `${SEEDED_TOURNAMENT_SOURCES} shipped by the seed, ${n - SEEDED_TOURNAMENT_SOURCES} `
    + 'registered by ingests. Each room the ingest runs for adds its own document:')
  for (const url of sql("select url from sources where data_type = 'tournaments' order by url").split('\n')) {
    console.log(`            ${url.trim().slice(0, 96)}`)
  }
}

if (bad) {
  console.log(`\n✖ ${bad} counts differ. Production is not what the seed describes — either a`)
  console.log('  seed-only change never shipped, or prod moved without the seed following.\n')
  process.exit(1)
}
console.log('\n  production matches the seed.\n')
