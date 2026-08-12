#!/usr/bin/env node
/**
 * MIGRATION 018, PROVED AGAINST A SNAPSHOT OF PRODUCTION'S ROWS.
 *
 * ⚠️ `supabase db reset` CANNOT TEST A BACKFILL, AND THAT IS NOT A WEAKNESS OF
 * OUR SETUP — IT IS THE ORDER RESET RUNS IN.
 *
 * Reset applies every migration to an EMPTY database and loads `seed.sql`
 * AFTERWARDS. So 018's first version passed locally while failing on
 * production, and the two results were never in tension:
 *
 *   · its constraint was added against ZERO rows and could not fail
 *   · its backfill UPDATE matched ZERO rows and did nothing
 *   · the seed then inserted rows that were already correct
 *
 * Every statement reported success without one of them being exercised. On
 * production the constraint met 42 rows holding `bounty_amount = 0.00` with
 * `bounty_funding` NULL — half a bounty fact on every row, created by the very
 * default the migration removes — and the transaction rolled back.
 *
 * So this gate builds the state reset cannot: a scratch database carrying
 * PRODUCTION'S ACTUAL TEMPLATE ROWS, pre-018, and applies 018 to it. Same shape
 * as `scripts/migration-017-gate.mjs`, which does it for permissions.
 *
 *   PROD_DATABASE_URL=... node scripts/migration-018-gate.mjs [path-to-018.sql]
 *
 * The optional path exists so the BROKEN version can be run through the same
 * gate — a gate that has only ever seen the fixed file has not been tested.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

import { resolvePsql } from './psql-path.mjs'
import { prodTarget } from './db-target.mjs'

const PSQL = resolvePsql()
/* Read-only. The snapshot is a SELECT; nothing here writes to production. */
const PROD = prodTarget('migration-018-gate')
const ADMIN = process.env.SCRATCH_ADMIN_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const DBNAME = 'cid_scratch_018'
const SCRATCH = ADMIN.replace(/\/[^/?]+(\?|$)/, `/${DBNAME}$1`)
const MIGRATION = process.argv[2] ?? 'supabase/migrations/00000000000018_bounty_semantics.sql'

const run = (url, sql) =>
  execFileSync(PSQL, [url, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim()
const runFile = (url, path) =>
  execFileSync(PSQL, [url, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-f', path], { encoding: 'utf8' })

let failed = 0
const ok = (cond, msg, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failed++
}

/**
 * ⚠️ EVERY REAL COLUMN, READ FROM PRODUCTION RATHER THAN LISTED BY HAND.
 *
 * The hand-written list omitted `rebuy_amount` while carrying `rebuy_unlimited`,
 * and `rebuy_details_need_a_price` refused the Wynn Friday rebuy row — a partial
 * snapshot failing a constraint that has nothing to do with 018. Any hand list
 * is one column behind the next migration.
 *
 * EXCLUDED, and each earns it: `id` and the timestamps are regenerated;
 * `room_id`, `series_id` and `source_id` are foreign keys into tables this
 * scratch database deliberately does not carry; generated columns are computed.
 */
const SKIP = new Set(['id', 'room_id', 'series_id', 'source_id', 'created_at', 'updated_at'])

console.log('\nMIGRATION 018 — SCRATCH GATE, SEEDED FROM PRODUCTION')
console.log(`  migration under test: ${MIGRATION}\n`)

const COLS = execFileSync(PSQL, [PROD, '-qtAX', '-c',
  `select column_name from information_schema.columns
    where table_name='tournament_templates' and is_generated='NEVER'
    order by ordinal_position`], { encoding: 'utf8' })
  .trim().split('\n').map((c) => c.trim()).filter((c) => c && !SKIP.has(c)).join(', ')

run(ADMIN, `drop database if exists ${DBNAME}`)
run(ADMIN, `create database ${DBNAME}`)

try {
  run(SCRATCH, `do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;`)

  /* ⚠️ A STUB `auth.jwt()`, THE SAME SCAFFOLDING AS THE PLATFORM ROLES ABOVE.
     Supabase provides the `auth` schema; a bare Postgres does not, and eight
     lines across migrations 004-009 call `auth.jwt()`. Stubbing it lets every
     REAL migration run, which is the fidelity this gate is for — the
     alternative was hand-building the table 018 touches, which would prove the
     migration against a schema nobody runs. It returns an empty claim set, so
     every is-admin check reads false; nothing in 018 consults it. */
  run(SCRATCH, `create schema if not exists auth;
    create or replace function auth.jwt() returns jsonb
    language sql stable as $fn$ select '{}'::jsonb $fn$;`)

  /* EVERY MIGRATION EXCEPT THE ONE UNDER TEST. That reproduces production's
     schema exactly — 019 and 020 are already applied there, 018 is not. */
  const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    if (f.includes('_bounty_semantics')) continue
    runFile(SCRATCH, `supabase/migrations/${f}`)
  }
  console.log(`  applied ${files.length - 1} migrations (everything but 018)`)

  /* ⚠️ ONE SCAFFOLD ROOM, LABELLED AS SUCH. 018 does not read `rooms`; the row
     exists only to satisfy the foreign key. The SNAPSHOT is the template rows,
     which is what the migration operates on. */
  run(SCRATCH, `insert into markets (slug, name) values ('scratch','Scratch')
                on conflict (slug) do nothing;
                insert into rooms (market_id, slug, name, area, latitude, longitude)
                select id, 'scratch-room', 'Scratch Room', 'strip', 36.1, -115.1
                  from markets where slug='scratch';`)

  /* ⚠️ COPIED STRAIGHT IN, WITH A TEMPORARY room_id DEFAULT. The first version
     staged the snapshot through a text temp table and failed on the first typed
     column — `game` is a game_kind, `start_time` a time, the money columns
     numeric. Hand-casting 22 columns would be 22 chances to cast one wrongly and
     prove the migration against data that is not production's. COPY moves the
     values into their real types with no intermediate representation; the
     default is scaffolding so the FK is satisfied without room_id being in the
     column list, and it is dropped immediately. */
  const roomId = run(SCRATCH, "select id from rooms where slug='scratch-room'")
  run(SCRATCH, `alter table tournament_templates alter column room_id set default '${roomId}'::uuid`)
  const tsv = execFileSync(
    PSQL, [PROD, '-qtAX', '-c', `copy (select ${COLS} from tournament_templates order by slug) to stdout`],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  execFileSync(
    PSQL, [SCRATCH, '-qtAX', '-v', 'ON_ERROR_STOP=1',
      '-c', `copy tournament_templates (${COLS}) from stdin`],
    { input: tsv, encoding: 'utf8' })
  run(SCRATCH, 'alter table tournament_templates alter column room_id drop default')

  console.log('\n  the state reset cannot build')
  const before = Number(run(SCRATCH, 'select count(*) from tournament_templates'))
  const zeros = Number(run(SCRATCH, 'select count(*) from tournament_templates where bounty_amount = 0'))
  ok(before > 0, 'production rows are in the scratch database', `${before} templates`)
  ok(zeros === 42, 'and 42 of them hold bounty_amount 0.00, exactly as production does', `${zeros}`)
  const dflt = run(SCRATCH, `select coalesce(column_default,'none') from information_schema.columns
     where table_name='tournament_templates' and column_name='bounty_amount'`)
  ok(dflt !== 'none', 'the DEFAULT that invented them is still there', dflt)

  console.log('\n  applying 018')
  try {
    runFile(SCRATCH, MIGRATION)
    console.log('    applied cleanly')
  } catch (e) {
    const msg = String(e.stderr ?? e.message ?? e)
    const line = (msg.match(/ERROR:[^\n]*/) ?? [msg.slice(0, 200)])[0]
    ok(false, '018 APPLIED WITHOUT ERROR', line)
    console.error(`\n  ⚠️  018 FAILED AGAINST PRODUCTION'S ROWS — the same way it failed on prod:`)
    console.error(`      ${line}\n`)
    throw Object.assign(new Error('018 failed'), { handled: true })
  }

  console.log('\n  what the backfill did')
  ok(Number(run(SCRATCH, 'select count(*) from tournament_templates where bounty_amount = 0')) === 0,
    'no row still claims a bounty of 0 — the 42 invented figures are gone')
  ok(Number(run(SCRATCH, 'select count(*) from tournament_templates where bounty_amount is null')) === before,
    'every row now says "nobody checked" instead', `${before} rows NULL`)
  ok(run(SCRATCH, `select coalesce(column_default,'none') from information_schema.columns
     where table_name='tournament_templates' and column_name='bounty_amount'`) === 'none',
    'and the DEFAULT is gone, so no future row invents another')

  console.log('\n  the constraint, both halves')
  const slug = run(SCRATCH, 'select slug from tournament_templates limit 1')
  for (const [set, label] of [
    ["bounty_amount = 50", 'an amount with no funding'],
    ["bounty_funding = 'added_to_entry'", 'a funding with no amount'],
  ]) {
    let refused = false
    try { run(SCRATCH, `update tournament_templates set ${set} where slug = '${slug}'`) } catch (e) {
      refused = /bounty_is_whole_or_absent/.test(String(e.stderr ?? e.message))
    }
    ok(refused, `${label} is refused by bounty_is_whole_or_absent`)
  }

  console.log('\n  the price, both funding directions')
  run(SCRATCH, `insert into tournament_templates
      (room_id, slug, name, game, start_time, entry_amount, fee_amount,
       bounty_amount, bounty_funding, source_url, fetched_at)
    select (select id from rooms where slug='scratch-room'), 'g-added', 'added', 'nlh',
           time '17:00', 160, 20, 50, 'added_to_entry', 'u', now();
    insert into tournament_templates
      (room_id, slug, name, game, start_time, entry_amount, fee_amount,
       bounty_amount, bounty_funding, source_url, fetched_at)
    select (select id from rooms where slug='scratch-room'), 'g-pool', 'pool', 'nlh',
           time '17:00', 160, 20, 50, 'from_prize_pool', 'u', now();`)
  const total = (s) => run(SCRATCH, `select total_buy_in::text from tournament_templates where slug='${s}'`)
  const pct = (s) => run(SCRATCH, `select fee_percent::text from tournament_templates where slug='${s}'`)
  ok(total('g-added') === '230.00', 'added_to_entry RAISES the price — 160+20+50', total('g-added'))
  ok(total('g-pool') === '180.00', 'from_prize_pool leaves it alone — 160+20', total('g-pool'))
  /* ⚠️ THE DENOMINATOR MOVED WITH IT. A fee share computed against a price the
     site does not show is a wrong number on the one figure a room is judged by. */
  ok(pct('g-added') === '8.70', 'fee_percent recomputes against 230', pct('g-added'))
  ok(pct('g-pool') === '11.11', 'and against 180 when the bounty is not part of the price', pct('g-pool'))
} catch (e) {
  if (!e.handled) throw e
} finally {
  run(ADMIN, `drop database if exists ${DBNAME}`)
  console.log('\n  scratch database dropped')
}

console.log(`\n  ${failed} failed\n`)
process.exit(failed ? 1 : 0)
