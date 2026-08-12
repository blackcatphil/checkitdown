#!/usr/bin/env node
/**
 * ONE-SHOT: correct the `record_events` comment already deployed to production.
 *
 * ⚠️ WHY A SCRIPT AND NOT A PASTED LINE.
 *
 * Migration 017 is APPLIED on production and matches the repo byte for byte. It
 * must not be re-applied. But one string inside it was wrong — the deployed
 * comment claimed "EXECUTE is service_role only" when service_role has had
 * EXECUTE revoked and the sole holder is `cid_events_writer`. That text lives in
 * `pg_description`, which is what somebody reads with `\df+` when they are
 * trying to find out who can call this function, usually at the worst possible
 * hour. A false security claim in the catalog cannot be fixed by correcting the
 * migration, because nothing re-runs it.
 *
 * ⚠️ THE STATEMENT IS READ OUT OF THE MIGRATION FILE, NOT RETYPED HERE. There
 * are already two copies of this claim in the repo (the file header and the
 * comment) and they drifted apart — which is the whole bug. A third hand-typed
 * copy in this script would be the same mistake with better intentions. The file
 * is the source; this only carries it to production.
 *
 *   PROD_DATABASE_URL=... node scripts/fix-record-events-comment.mjs
 *
 * Idempotent: applying the same comment twice is the same comment.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { resolvePsql } from './psql-path.mjs'
import { prodTarget } from './db-target.mjs'

const PSQL = resolvePsql()
const DB = prodTarget('fix-record-events-comment', { writes: true })

const MIGRATION = 'supabase/migrations/00000000000017_analytics_events.sql'
const sql = readFileSync(MIGRATION, 'utf8')

/* The whole `comment on function ... ;` statement, exactly as the file spells
   it, string concatenation and all. */
const stmt = sql.match(/comment on function public\.record_events\(jsonb\) is[\s\S]*?;/)?.[0]
if (!stmt) {
  console.error(`\nREFUSING TO RUN — no \`comment on function public.record_events(jsonb)\``
    + `\nstatement found in ${MIGRATION}. Nothing to carry.\n`)
  process.exit(2)
}
if (/service_role only/.test(stmt)) {
  console.error(`\nREFUSING TO RUN — the statement in ${MIGRATION} still says`
    + `\n"service_role only". Fix the migration first; this script only carries`
    + `\nwhat the file says, and carrying the wrong claim is the bug it exists to`
    + `\nrepair.\n`)
  process.exit(2)
}

const run = (q) =>
  execFileSync(PSQL, [DB, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim()

const READ = `select obj_description('public.record_events(jsonb)'::regprocedure, 'pg_proc')`

console.log('\n  BEFORE:')
console.log(`    ${run(READ) || '(no comment)'}`)

run(stmt)

const after = run(READ)
console.log('\n  AFTER:')
console.log(`    ${after}`)

/* Verified by reading it back, not by the absence of an error. */
const wrong = /service_role only/.test(after)
const right = /cid_events_writer ONLY/.test(after)
console.log(`\n  no longer claims service_role: ${!wrong}`)
console.log(`  names cid_events_writer as the holder: ${right}`)
process.exit(!wrong && right ? 0 : 1)
