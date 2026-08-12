#!/usr/bin/env node
/**
 * ⚠️ PORT INSTRUMENT, NOT A GATE. This is scaffolding for the one-off job of
 * moving the Wynn ingest onto the shared rails. It does not run in CI, it
 * guards nothing, and it should be read as a tool rather than a check.
 *
 * EMPTY THE TOURNAMENT TABLES ON LOCAL, and prove they are empty.
 *
 * ═══ WHY THE EQUIVALENCE PROOF NEEDS THIS ═══
 *
 * The first "zero differences" run was worthless and looked identical to a good
 * one. Local already held Wynn's rows — from `seed.sql` and an earlier run — and
 * the ingest is idempotent by design: `on conflict (slug) do nothing` on the
 * templates, and a `structure_hash` comparison that skips a sheet whose content
 * has not moved. So an ingest that wrote NOTHING AT ALL produced a database
 * that matched production exactly, and the diff said zero.
 *
 * That is the defect this whole arc is named for: `dailies: 4` once passed
 * against a database that had never been written to. A proof that cannot fail
 * is not a proof, and "the rows are there" is not evidence that THIS RUN put
 * them there.
 *
 * So the baseline is taken against an empty target, where every row the diff
 * later matches had to be written by the run under test.
 *
 * ⚠️ localTarget — THIS TRUNCATES. It cannot be pointed at production under any
 * spelling; see scripts/db-target.mjs.
 *
 *   DATABASE_URL=... node scripts/wynn-reset-local.mjs
 */
import { execFileSync } from 'node:child_process'

import { resolvePsql } from './psql-path.mjs'
import { localTarget } from './db-target.mjs'

const PSQL = resolvePsql()
const DB = localTarget('wynn-reset-local')

const sql = (q) =>
  execFileSync(PSQL, [DB, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim()

const COUNTS = [
  ['tournament_levels', 'select count(*) from tournament_levels'],
  ['tournament_instances', 'select count(*) from tournament_instances'],
  ['tournament_templates', 'select count(*) from tournament_templates'],
  ['tournament_series', 'select count(*) from tournament_series'],
  ['change_log (tournament rows)',
    "select count(*) from change_log where target_table in "
    + "('tournament_templates','tournament_levels')"],
]

const census = (label) => {
  console.log(`  ${label}`)
  const out = {}
  for (const [name, q] of COUNTS) {
    out[name] = Number(sql(q))
    console.log(`    ${name.padEnd(30)} ${out[name]}`)
  }
  return out
}

console.log('\nWYNN LOCAL RESET — emptying the tournament tables\n')
census('before:')

/* One statement, one transaction. `cascade` is deliberate and safe here because
   the four tables are the whole graph — levels and instances hang off templates,
   templates off series — and nothing else in the schema references them. */
sql(`truncate tournament_levels, tournament_instances, tournament_templates,
     tournament_series restart identity cascade;
     delete from change_log where target_table in
       ('tournament_templates','tournament_levels');`)

console.log()
const after = census('after:')

/* ⚠️ ASSERTED, NOT ASSUMED. "I ran a truncate" and "the tables are empty" are
   different claims, and the entire value of the baseline rests on the second
   one. A truncate that silently affected nothing would hand the port exactly
   the false green this script exists to remove. */
const dirty = Object.entries(after).filter(([, n]) => n !== 0)
if (dirty.length) {
  console.error(`\n  ⚠️  NOT EMPTY: ${dirty.map(([k, n]) => `${k}=${n}`).join(', ')}`)
  console.error('  The baseline would be meaningless. Refusing to report success.\n')
  process.exit(1)
}
console.log('\n  all five are zero — a run against this target must write every row it is credited with\n')
