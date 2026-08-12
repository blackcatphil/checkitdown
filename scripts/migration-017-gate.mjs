#!/usr/bin/env node
/**
 * MIGRATION 017, PROVED FROM THE FILE — on a database that has never seen
 * anything else.
 *
 * ⚠️ WHY THE LOCAL RUN WAS NOT A GATE. The first version of this migration
 * omitted `revoke all on function … from public`, and anon still got a 401
 * locally. That looked like proof and was not: Postgres grants EXECUTE ON
 * FUNCTION TO PUBLIC by default at creation, so the file as written left the
 * function callable by every role in the cluster — the local database refused
 * for an unrelated reason (the role could not reach the schema by that path).
 * A permission demonstrated by the environment is not a permission the
 * migration grants.
 *
 * So this builds a scratch database, applies ONLY 017 to it, creates the anon
 * and service_role roles the way the platform does, and asks — as those roles —
 * whether they can reach the table or the function. Nothing else is in there:
 * no seed, no other migration, no PostgREST.
 *
 *   node scripts/migration-017-gate.mjs
 */
import { execFileSync } from 'node:child_process'

import { resolvePsql } from './psql-path.mjs'

const PSQL = resolvePsql()
const ADMIN = process.env.SCRATCH_ADMIN_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const DBNAME = 'cid_scratch_017'
const SCRATCH = ADMIN.replace(/\/[^/?]+(\?|$)/, `/${DBNAME}$1`)

const run = (url, sql) =>
  execFileSync(PSQL, [url, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim()
const runFile = (url, path) =>
  execFileSync(PSQL, [url, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-f', path], { encoding: 'utf8' })
/**
 * ⚠️ A DENIAL MUST NAME THE THING IT DENIED.
 *
 * `permission denied` alone is not evidence: "permission denied to set role"
 * contains it, and an earlier version of this file scored two of those as
 * passes — the probe failing to assume the identity, read as the identity being
 * correctly refused. Every negative assertion below therefore checks that the
 * message names the object, so a broken probe cannot look like a locked door.
 */
const deniedOn = (r, object) =>
  !r.ok && /permission denied for/i.test(r.out) && r.out.includes(object)

/** Runs as a role and returns either its answer or the error it was given. */
const asRole = (role, sql) => {
  try {
    return { ok: true, out: run(SCRATCH, `set role ${role}; ${sql}`) }
  } catch (e) {
    const msg = String(e.stderr ?? e.message ?? e)
    return { ok: false, out: (msg.match(/ERROR:[^\n]*/) ?? [msg.slice(0, 120)])[0] }
  }
}

let failed = 0
const ok = (cond, msg, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failed++
}

console.log('\nMIGRATION 017 — SCRATCH DATABASE GATE\n')

/* A scratch database with nothing in it. Dropped first in case a previous run
   died holding it. */
run(ADMIN, `drop database if exists ${DBNAME}`)
run(ADMIN, `create database ${DBNAME}`)

try {
  /* The roles the platform provides. `rooms` is the one dependency 017 has —
     a FK target — so a minimal stand-in is created rather than pulling in the
     whole schema, which would make this a test of the seed. */
  run(SCRATCH, `
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    create table public.rooms (id uuid primary key default gen_random_uuid(), slug text unique);
    grant usage on schema public to anon, authenticated, service_role;`)

  runFile(SCRATCH, 'supabase/migrations/00000000000017_analytics_events.sql')
  console.log('  applied: 00000000000017_analytics_events.sql (and nothing else)\n')

  /* TEST SCAFFOLDING, NOT PART OF THE MIGRATION. `set role` needs membership,
     and the local `postgres` is not a superuser, so without this every writer
     assertion fails with "permission denied to set role" — which two of them
     then counted as a PASS, because the message happens to contain "permission
     denied". A false green produced by the probe's own setup. Membership is
     granted here so the writer assertions test the writer's grants; the
     `assertion` helper below is what stops the two being confused again. */
  run(SCRATCH, 'grant cid_events_writer, anon, authenticated, service_role to postgres')

  /* ── What the FILE produced, not what a live database happens to allow ── */
  console.log('  ownership and body')
  const owner = run(SCRATCH, `select pg_get_userbyid(proowner) from pg_proc
    where proname='record_events' and pronamespace='public'::regnamespace`)
  ok(owner === 'postgres', 'record_events is owned by postgres, so SECURITY DEFINER runs as postgres', owner)
  const secdef = run(SCRATCH, `select prosecdef::text from pg_proc where proname='record_events'`)
  ok(secdef === 'true', 'and it is SECURITY DEFINER')
  const cfg = run(SCRATCH, `select coalesce(array_to_string(proconfig,','),'NONE') from pg_proc where proname='record_events'`)
  ok(cfg.includes('search_path='), 'with search_path pinned — an unqualified name in a definer function is an escalation primitive', cfg)

  /* ⚠️ A SECURITY DEFINER FUNCTION IS ONLY AS NARROW AS ITS BODY. Dynamic SQL
     would let a caller's input choose what runs as the owner. */
  const body = run(SCRATCH, `select prosrc from pg_proc where proname='record_events'`)
  const dynamic = /\bexecute\b|\bformat\s*\(|\bquote_ident\b|\bdblink\b|\bcopy\b/i.test(body)
  ok(!dynamic, 'the body contains no dynamic SQL — no EXECUTE, no format(), no quote_ident',
    dynamic ? 'FOUND dynamic SQL' : `${body.split('\n').length} lines, one INSERT ... SELECT`)

  console.log('\n  the three anon probes, as the roles themselves')
  /* 404-equivalent: the table is not reachable at all. PostgREST answers 404
     because the schema is not exposed; at the SQL layer the same fact shows as
     permission denied for the schema. */
  const a1 = asRole('anon', 'select count(*) from analytics.events')
  ok(deniedOn(a1, 'analytics'),
    'anon cannot SELECT analytics.events (PostgREST: 404, schema not exposed)', a1.out)

  const a2 = asRole('anon', `insert into analytics.events
    (event_name, device_id, session_id, bot_rules_version)
    values ('room_facts_view','aaaaaaaaaa','bbbbbbbbbb','forged')`)
  ok(deniedOn(a2, 'analytics'),
    'anon cannot INSERT into it either (PostgREST: 406, invalid schema)', a2.out)

  const a3 = asRole('anon', `select public.record_events('[]'::jsonb)`)
  ok(deniedOn(a3, 'record_events'),
    'anon cannot EXECUTE record_events (PostgREST: 401) — the REVOKE FROM PUBLIC is what makes this true',
    a3.out)

  const a4 = asRole('authenticated', `select public.record_events('[]'::jsonb)`)
  ok(deniedOn(a4, 'record_events'), 'and neither can authenticated', a4.out)

  /* ⚠️ service_role IS TAKEN BACK OFF. The REST door is closed, not merely
     unused. Note service_role is NOT superuser here, so this is a real test. */
  const a5 = asRole('service_role', `select public.record_events('[]'::jsonb)`)
  ok(deniedOn(a5, 'record_events'),
    'service_role has had EXECUTE revoked — the unused REST door is shut, not left ajar', a5.out)

  console.log('\n  the writer role, which must be able to do exactly one thing')
  const w1 = asRole('cid_events_writer', `select public.record_events('[]'::jsonb)`)
  ok(w1.ok, 'cid_events_writer CAN execute record_events', w1.ok ? `returned ${w1.out}` : w1.out)

  /* THE POSITIVE CONTROL'S OTHER HALF: able to call the door, unable to walk
     round it. A writer holding both could write rows the function would have
     rejected, and the two paths would drift apart silently. */
  const w2 = asRole('cid_events_writer', `insert into analytics.events
    (event_name, device_id, session_id, bot_rules_version)
    values ('room_facts_view','aaaaaaaaaa','bbbbbbbbbb','direct')`)
  ok(deniedOn(w2, 'events'),
    'and CANNOT insert into analytics.events directly — the function stays the single door', w2.out)

  const w3 = asRole('cid_events_writer', 'select count(*) from analytics.events')
  ok(deniedOn(w3, 'events'), 'nor read the table it writes to', w3.out)

  /* And the function actually works when called properly — a door that refuses
     everybody is a wall. */
  const w4 = asRole('cid_events_writer', `select public.record_events(
    '[{"event_name":"room_facts_view","device_id":"aaaaaaaaaa","session_id":"bbbbbbbbbb","bot_rules_version":"gate","bot":false,"is_internal":false}]'::jsonb)`)
  ok(w4.ok && w4.out === '1', 'and one real event written through it lands', w4.out)
  ok(run(SCRATCH, 'select count(*) from analytics.events') === '1',
    'the row is in the table, written by a role that cannot see it')

  /* ⚠️ THE TABLE THAT DOES NOT EXIST YET. Every other assertion here is about
     `analytics.events`. This one is about the NEXT table somebody adds to this
     schema — the one that will be created without reading this file. Migration
     002's auto-REVOKE is scoped to `public`, so nothing else covers it.

     ⚠️ AND IT IS NOT TESTED BY `select count(*)` AS anon. That was the first
     version and it passed for the wrong reason: anon has no USAGE on the schema
     either, so it is refused at the schema door and never reaches the table.
     The message said "permission denied for SCHEMA analytics" — a denial that
     would read identically if the default-privileges line were deleted. Same
     false-green class as `permission denied to set role`, caught by reading the
     object name in the error rather than trusting the word "denied".

     `has_table_privilege` asks the question directly: does this role hold SELECT
     ON THIS TABLE, independent of whether it could get to the schema. That is
     the grant `alter default privileges` actually governs. */
  /* ── DEVICES: the table retention must never touch ─────────────────────── */
  console.log('\n  analytics.devices — the unbounded-history table')
  const holdsOn = (role, tbl) =>
    run(SCRATCH, `select has_table_privilege('${role}', '${tbl}', 'SELECT')::text`)
  ok(holdsOn('anon', 'analytics.devices') === 'false'
    && holdsOn('authenticated', 'analytics.devices') === 'false',
    'devices is closed to anon and authenticated — it is the longest-lived data here')

  const d0 = asRole('cid_events_writer', 'select count(*) from analytics.devices')
  ok(deniedOn(d0, 'devices'), 'and the writer cannot read it either', d0.out)

  ok(run(SCRATCH, `select count(*) from analytics.devices where device_id='aaaaaaaaaa'`) === '1',
    'the event above created its device row — written on first sight, through the same door')

  /* ⚠️ THE ASSERTION THE NORTH STAR DEPENDS ON. `on conflict do nothing` vs
     `do update set first_seen_at = now()` both compile and both run. The second
     turns first-seen into last-seen, after which "new reach" counts every
     returning reader as new — silently, permanently, and upward. Nothing else
     in this repo could catch that. */
  const seenBefore = run(SCRATCH, `select first_seen_at::text from analytics.devices where device_id='aaaaaaaaaa'`)
  asRole('cid_events_writer', `select public.record_events(
    '[{"event_name":"map_filter_apply","device_id":"aaaaaaaaaa","session_id":"cccccccccc","bot_rules_version":"gate","bot":false,"is_internal":false}]'::jsonb)`)
  const seenAfter = run(SCRATCH, `select first_seen_at::text from analytics.devices where device_id='aaaaaaaaaa'`)
  ok(seenBefore === seenAfter && run(SCRATCH, 'select count(*) from analytics.devices') === '1',
    'a SECOND event does not move first_seen_at — first-seen stays first-seen, or "new reach" counts returning readers as new',
    seenBefore === seenAfter ? 'unchanged' : `MOVED ${seenBefore} -> ${seenAfter}`)

  console.log('\n  default privileges — the table nobody has written yet')
  const holds = (role, tbl) =>
    run(SCRATCH, `select has_table_privilege('${role}', '${tbl}', 'SELECT')::text`)

  run(SCRATCH, 'create table analytics.table_two (id int)')
  ok(holds('anon', 'analytics.table_two') === 'false',
    'a NEW table in analytics grants anon no SELECT on arrival')
  ok(holds('authenticated', 'analytics.table_two') === 'false',
    'nor authenticated')

  /* ⚠️ THE POSITIVE CONTROL, AND THIS ONE IS NOT OPTIONAL. `false` is also what
     a probe returns when it is asking the wrong question. So: install exactly
     the granting default that hosted Supabase ships, create another table, and
     confirm the probe SEES the grant. If this control does not go true, the two
     assertions above prove nothing. Torn down immediately after. */
  run(SCRATCH, 'alter default privileges in schema analytics grant select on tables to anon')
  run(SCRATCH, 'create table analytics.table_three (id int)')
  ok(holds('anon', 'analytics.table_three') === 'true',
    'CONTROL: with a granting default installed, the probe DOES see the grant — so the two `false`s above are answers, not blind spots')
  run(SCRATCH, 'alter default privileges in schema analytics revoke select on tables from anon')
  run(SCRATCH, 'drop table analytics.table_two, analytics.table_three')

  console.log('\n  the seven event names')
  const names = run(SCRATCH, `select string_agg(enumlabel,', ' order by enumsortorder)
    from pg_enum e join pg_type t on t.oid=e.enumtypid
    join pg_namespace n on n.oid=t.typnamespace
    where t.typname='event_name' and n.nspname='analytics'`)
  ok(names.split(', ').length === 7, 'seven, including source_link_click', names)
} finally {
  run(ADMIN, `drop database if exists ${DBNAME}`)
  console.log(`\n  scratch database dropped`)
}

console.log(`\n  ${failed} failed\n`)
process.exit(failed ? 1 : 0)
