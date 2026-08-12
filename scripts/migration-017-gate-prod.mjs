#!/usr/bin/env node
/**
 * MIGRATION 017, PROVED AGAINST PRODUCTION — after it has been applied.
 *
 * ⚠️ WHY THIS EXISTS AS A SECOND FILE RATHER THAN A FLAG.
 *
 * `migration-017-gate.mjs` builds a scratch database, applies only 017, and
 * asks the roles what they can reach. That is the right test of what the FILE
 * grants, and it is impossible here: hosted Supabase does not permit
 * `CREATE DATABASE`. More importantly, the scratch gate is evidence about a
 * LOCAL cluster — and this project has already watched hosted defaults invert
 * local behaviour once (migration 002: policies inert without GRANTs, schema
 * looking flawless).
 *
 * So this file runs the same assertions against the real database, in the state
 * it is actually in. It is a READ-MOSTLY script by construction:
 *
 *   · NO create database, NO drop database, NO truncate, NO reset. Grep this
 *     file for those words and you will find them only in this comment.
 *   · The only writes are: one membership grant (revoked at the end), two
 *     throwaway tables in `analytics` (dropped), and ONE event row — which is
 *     written with `is_internal = true`, because the first row in production
 *     must not be countable as traffic. There is no delete afterwards; the row
 *     stays, correctly flagged, and the events table is append-only by design.
 *
 *   node scripts/migration-017-gate-prod.mjs
 *
 * Requires PROD_DATABASE_URL. It does NOT read DATABASE_URL — that name means
 * local now — and it refuses any URL that is not the production project.
 */
import { execFileSync } from 'node:child_process'

import { resolvePsql } from './psql-path.mjs'
import { prodTarget } from './db-target.mjs'

const PSQL = resolvePsql()
/* ⚠️ NO `?? process.env.DATABASE_URL` FALLBACK — it was there, and it is gone.
   That fallback is precisely how this gate could be aimed at production by a
   shell that happened to hold the old variable, and it left three throwaway
   tables in the production analytics schema on 2026-08-12. `DATABASE_URL` means
   local now, and this file cannot read it. */
const DB = prodTarget('migration-017-gate-prod', { writes: true })

/**
 * Passwords never reach stdout, including inside psql's error text.
 *
 * ⚠️ TWO PASSES, AND THE SECOND IS LENGTH-GUARDED. The positional pass handles
 * the URL itself. The blanket pass exists for error text that quotes the
 * password outside a URL — but it is skipped for short secrets, because the
 * local password is the word `postgres`, which is also the scheme, the user and
 * the database name: blanket-replacing it turned a diagnostic into
 * `***ql://***:***@127.0.0.1:54322/***`. Over-redaction that destroys the
 * message is its own failure — the point of printing the URL is to show which
 * database was refused.
 */
const secret = (DB.match(/:\/\/[^:]+:([^@]+)@/) ?? [])[1]
const redact = (s) => {
  const out = String(s).replace(/:\/\/([^:@/]+):[^@]*@/g, '://$1:***@')
  return secret && secret.length >= 12 ? out.split(secret).join('***') : out
}

/**
 * ⚠️ THE PASSWORD IS VISIBLE IN THE PROCESS LIST WHILE THIS RUNS.
 *
 * The URL is passed as an argv element, so anyone able to run `ps` on this
 * machine during the seconds this gate takes can read the production password.
 * KNOWN AND ACCEPTED, not overlooked: this is run by hand, on a maintainer's own
 * machine, a handful of times. Every other psql-driving script in this repo
 * (`events-probe`, `prod-census`, the scratch gate) passes the URL the same way,
 * so changing it here alone would leave the habit in place while making this one
 * file look safe.
 *
 * The fix, if this ever runs anywhere shared or automated: put the password in
 * `PGPASSWORD` (env of the child only) or `~/.pgpass`, and pass the rest as
 * flags. That is a change to every one of those scripts at once, not a patch
 * here — filed rather than half-done.
 */
const run = (sql) =>
  execFileSync(PSQL, [DB, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim()

/**
 * ⚠️ A DENIAL MUST NAME THE THING IT DENIED. `permission denied` alone is not
 * evidence — "permission denied to set role" contains it, and an earlier
 * version of the local gate scored two of those as passes: the probe failing to
 * assume an identity, read as the identity being correctly refused.
 */
const deniedOn = (r, object) =>
  !r.ok && /permission denied for/i.test(r.out) && r.out.includes(object)

const asRole = (role, sql) => {
  try {
    return { ok: true, out: run(`set role ${role}; ${sql}`) }
  } catch (e) {
    const msg = redact(String(e.stderr ?? e.message ?? e))
    return { ok: false, out: (msg.match(/ERROR:[^\n]*/) ?? [msg.slice(0, 120)])[0] }
  }
}

let failed = 0
const ok = (cond, msg, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}${detail ? ` — ${redact(detail)}` : ''}`)
  if (!cond) failed++
}

/**
 * ⚠️ THE TWO THINGS THIS GATE TEMPORARILY DOES TO PRODUCTION, AND WHY THEIR
 * CLEANUP IS NOT ALLOWED TO DEPEND ON THE HAPPY PATH.
 *
 * The control installs a GRANTING default privilege — the very state this gate
 * exists to detect — and the probe tables are real tables in a real schema. An
 * earlier version removed both with unprotected lines two statements later. Any
 * throw in between (a failed assertion, a dropped connection, a Ctrl-C) would
 * have left production granting anon SELECT on every future table in
 * `analytics`.
 *
 * And it would not have presented as our bug. The NEXT run would read the
 * leftover, see anon holding SELECT on a brand-new table, and print the STOP
 * block — diagnosing Supabase for our own residue and halting the deploy on it.
 * A cleanup that runs only when nothing went wrong is not a cleanup.
 *
 * So both are idempotent, both run in their own `finally`, both run AGAIN in the
 * outer `finally` (a crash before the control is even reached still leaves prod
 * clean), and both VERIFY rather than assume — reporting the state they leave
 * behind, with the exact line to paste if they could not fix it.
 */
const grantingDefault = () => run(
  `select coalesce(string_agg(array_to_string(defaclacl, ' '), ' | '), 'none')
   from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'analytics'`)

const probeTablesLeft = () => run(
  `select coalesce(string_agg(tablename, ', '), 'none') from pg_tables
   where schemaname='analytics' and tablename like 'gate\\_probe\\_%'`)

const REVOKE_LINE = 'alter default privileges in schema analytics revoke select on tables from anon;'
const DROP_LINE = 'drop table if exists analytics.gate_probe_one, analytics.gate_probe_two, analytics.gate_probe_three;'

/** Idempotent. Safe to call when the control never ran. */
function cleanupControl(where) {
  try {
    run(REVOKE_LINE)
    const left = grantingDefault()
    const dirty = /anon=/.test(left)
    console.log(`  CLEANUP [${where}] granting default removed — pg_default_acl on analytics: ${left}`)
    if (dirty) {
      console.error(`  ⚠️  A DEFAULT STILL GRANTS anon. Paste this:\n        ${REVOKE_LINE}`)
      failed++
    }
  } catch (e) {
    console.error(`  ⚠️  CLEANUP FAILED [${where}] — production may still grant anon SELECT on new`
      + `\n      analytics tables. Paste this:\n        ${REVOKE_LINE}\n      (${redact(e.message ?? e)})`)
    failed++
  }
}

/** Idempotent — `if exists`, so it is safe before any table is created. */
function cleanupProbeTables(where) {
  try {
    run(DROP_LINE)
    const left = probeTablesLeft()
    console.log(`  CLEANUP [${where}] probe tables dropped — remaining in analytics: ${left}`)
    if (left !== 'none') {
      console.error(`  ⚠️  PROBE TABLES REMAIN. Paste this:\n        ${DROP_LINE}`)
      failed++
    }
  } catch (e) {
    console.error(`  ⚠️  CLEANUP FAILED [${where}] — throwaway tables left in analytics.`
      + `\n      Paste this:\n        ${DROP_LINE}\n      (${redact(e.message ?? e)})`)
    failed++
  }
}

console.log('\nMIGRATION 017 — PRODUCTION GATE')
console.log(`  target: ${redact(DB)}`)
console.log('  read-mostly: no CREATE/DROP DATABASE, no truncate, no reset\n')

/**
 * ⚠️ THE PREDICATE IS "CAN I SET ROLE", NOT "AM I A MEMBER". THEY ARE DIFFERENT.
 *
 * This asked `pg_auth_members` whether postgres was a member of
 * `cid_events_writer`, and on production the answer was yes — so it borrowed
 * nothing, and then all five writer assertions died on
 * `permission denied to set role`.
 *
 * Since PG16 a membership carries three independent options, and INHERIT/ADMIN/
 * SET are not the same privilege. Supabase's `supabase_admin` grants membership
 * with **SET FALSE**: postgres is genuinely a member, and genuinely cannot
 * `SET ROLE` to it. `pg_auth_members` says "member" either way, so the check was
 * asking a question whose answer does not determine the thing it was used to
 * decide — a false negative that presents as five permission errors in a row and
 * looks like a broken migration.
 *
 * So the predicate is the capability itself: TRY the thing. `set role` either
 * works or it does not, and nothing about option bits has to be modelled here.
 *
 * ⚠️ AND THE REVOKE IS SAFE PRECISELY BECAUSE OF THE RULE THAT BIT US:
 * `REVOKE` removes only grants made by the CURRENT USER. Ours is granted by
 * postgres to itself (which carries SET TRUE); the platform's is granted by
 * `supabase_admin`. Revoking as postgres therefore removes ours and cannot touch
 * the platform's — which is also exactly how the confusing state arose in the
 * first place.
 */
const canSetRole = () => {
  try {
    run('set role cid_events_writer; reset role')
    return true
  } catch {
    return false
  }
}

const borrowedMembership = !canSetRole()
if (borrowedMembership) {
  console.log('  GRANT   cid_events_writer TO postgres  (borrowed for `set role`, returned at the end)')
  try {
    run('grant cid_events_writer to postgres')
  } catch (e) {
    /* ⚠️ GRANTING NEEDS *ADMIN* OPTION, WHICH IS A THIRD, SEPARATE THING.
       On production postgres holds the platform's membership with ADMIN TRUE /
       SET FALSE, so it can grant itself the SET-capable version. But if no
       membership exists at all there is no ADMIN either, and postgres cannot
       give itself a role it has no authority over — an honest wall, not a bug
       to code around. Reported as a refusal with the fix, rather than as the
       stack trace this used to be. */
    console.error(
      `\n  REFUSING TO CONTINUE — postgres cannot grant itself cid_events_writer.`
      + `\n  Granting requires the ADMIN option, and postgres holds no membership`
      + `\n  in this role at all, so it has none.`
      + `\n\n  Every writer assertion would fail with "permission denied to set role"`
      + `\n  and read as a broken migration. It is not one — it is a missing grant.`
      + `\n\n  Run this as a role with ADMIN on cid_events_writer (supabase_admin):`
      + `\n    grant cid_events_writer to postgres with admin option, set false;`
      + `\n\n  (${redact(e.message ?? e)})\n`,
    )
    failed++
    /* This run created nothing, but an EARLIER run may have died holding
       residue — and this exit is before the try/finally that would clear it.
       Both are idempotent, so sweeping here costs two statements and closes the
       one path out of this script that had no cleanup on it. */
    cleanupControl('refused-before-start')
    cleanupProbeTables('refused-before-start')
    process.exit(1)
  }
  if (!canSetRole()) {
    console.error('\n  ⚠️  STILL CANNOT `set role cid_events_writer` after granting. The five'
      + '\n      writer assertions below will fail for that reason and not for'
      + '\n      anything migration 017 did. Investigate before believing them.\n')
    failed++
  }
} else {
  /* Reported with its grantor so the two spellings of "member" stay
     distinguishable in the log rather than both reading as "fine". */
  const grantor = run(
    `select coalesce(string_agg(distinct pg_get_userbyid(m.grantor), ', '), 'nobody') from pg_auth_members m
     join pg_roles r on r.oid = m.roleid join pg_roles g on g.oid = m.member
     where r.rolname='cid_events_writer' and g.rolname='postgres'`)
  console.log(`  (postgres can already SET ROLE cid_events_writer — membership from ${grantor}.`)
  console.log('   Nothing borrowed, so nothing is returned. This gate leaves it exactly as found.)')
}

try {
  /* ── What is actually deployed ─────────────────────────────────────────── */
  console.log('\n  ownership and body')
  /* ⚠️ EVERY LOOKUP QUALIFIED BY pronamespace, not just the owner one.
     There is one `record_events` today, so the unqualified spellings returned
     the right answer — which is exactly why the inconsistency would have
     survived. The day a same-named function appears in another schema, an
     unqualified `select prosecdef ... where proname='record_events'` returns
     more than one row and psql prints both, and this gate starts reporting on
     a function that is not the one the app calls. */
  const FN = `from pg_proc where proname='record_events' and pronamespace='public'::regnamespace`
  const owner = run(`select pg_get_userbyid(proowner) ${FN}`)
  ok(owner === 'postgres', 'record_events is owned by postgres, so SECURITY DEFINER runs as postgres', owner)
  const secdef = run(`select prosecdef::text ${FN}`)
  ok(secdef === 'true', 'and it is SECURITY DEFINER')
  const cfg = run(`select coalesce(array_to_string(proconfig,','),'NONE') ${FN}`)
  ok(cfg.includes('search_path='), 'with search_path pinned — an unqualified name in a definer function is an escalation primitive', cfg)

  const body = run(`select prosrc ${FN}`)
  const dynamic = /\bexecute\b|\bformat\s*\(|\bquote_ident\b|\bdblink\b|\bcopy\b/i.test(body)
  ok(!dynamic, 'the body contains no dynamic SQL — no EXECUTE, no format(), no quote_ident',
    dynamic ? 'FOUND dynamic SQL' : `${body.split('\n').length} lines`)

  console.log('\n  the anon probes, as the roles themselves')
  const a1 = asRole('anon', 'select count(*) from analytics.events')
  ok(deniedOn(a1, 'analytics'), 'anon cannot SELECT analytics.events (PostgREST: 404, schema not exposed)', a1.out)

  const a2 = asRole('anon', `insert into analytics.events
    (event_name, device_id, session_id, bot_rules_version)
    values ('room_facts_view','aaaaaaaaaa','bbbbbbbbbb','forged')`)
  ok(deniedOn(a2, 'analytics'), 'anon cannot INSERT into it either (PostgREST: 406, invalid schema)', a2.out)

  const a3 = asRole('anon', `select public.record_events('[]'::jsonb)`)
  ok(deniedOn(a3, 'record_events'),
    'anon cannot EXECUTE record_events (PostgREST: 401) — the REVOKE FROM PUBLIC is what makes this true', a3.out)

  const a4 = asRole('authenticated', `select public.record_events('[]'::jsonb)`)
  ok(deniedOn(a4, 'record_events'), 'and neither can authenticated', a4.out)

  const a5 = asRole('service_role', `select public.record_events('[]'::jsonb)`)
  ok(deniedOn(a5, 'record_events'),
    'service_role has had EXECUTE revoked — the unused REST door is shut, not left ajar', a5.out)

  console.log('\n  the writer role, which must be able to do exactly one thing')
  const w1 = asRole('cid_events_writer', `select public.record_events('[]'::jsonb)`)
  ok(w1.ok, 'cid_events_writer CAN execute record_events', w1.ok ? `returned ${w1.out}` : w1.out)

  const w2 = asRole('cid_events_writer', `insert into analytics.events
    (event_name, device_id, session_id, bot_rules_version)
    values ('room_facts_view','aaaaaaaaaa','bbbbbbbbbb','direct')`)
  ok(deniedOn(w2, 'events'),
    'and CANNOT insert into analytics.events directly — the function stays the single door', w2.out)

  const w3 = asRole('cid_events_writer', 'select count(*) from analytics.events')
  ok(deniedOn(w3, 'events'), 'nor read the table it writes to', w3.out)

  /* ⚠️ is_internal = true. THE FIRST ROW IN PRODUCTION IS OURS, NOT A READER'S.
     This row is never deleted — the table is append-only and this script does
     not truncate — so it has to be correctly labelled at the moment it is
     written. A gate row counted as traffic is a number we made up about
     ourselves, in the first week, when the totals are smallest and a single row
     moves them most. */
  const before = Number(run('select count(*) from analytics.events'))
  const w4 = asRole('cid_events_writer', `select public.record_events(
    '[{"event_name":"room_facts_view","device_id":"gate000000","session_id":"gate000000",
       "bot_rules_version":"prod-gate","bot":false,"is_internal":true}]'::jsonb)`)
  ok(w4.ok && w4.out === '1', 'and one real event written through it lands', w4.out)
  const internal = run(`select is_internal::text from analytics.events
    where bot_rules_version='prod-gate' order by occurred_at desc limit 1`)
  ok(run('select count(*) from analytics.events') === String(before + 1) && internal === 'true',
    'the row is in the table, written by a role that cannot see it, and flagged is_internal',
    `is_internal=${internal}`)

  /* ── DEVICES — read-only here ──────────────────────────────────────────
     The idempotence property (a second event must not move `first_seen_at`)
     is proved in the scratch gate, where a second write costs nothing. This
     gate deliberately writes ONE event, so it asserts only what that one event
     lets it: the row exists, and the table is shut. */
  console.log('\n  analytics.devices — the table retention never touches')
  const holds = (role, tbl) => run(`select has_table_privilege('${role}', '${tbl}', 'SELECT')::text`)
  ok(holds('anon', 'analytics.devices') === 'false'
    && holds('authenticated', 'analytics.devices') === 'false',
    'devices is closed to anon and authenticated on production')
  ok(run(`select count(*) from analytics.devices where device_id='gate000000'`) === '1',
    'the gate event created its device row — written on first sight, through the same door')

  /* ── THE ASSERTIONS ONLY PRODUCTION CAN ANSWER ─────────────────────────── */
  console.log('\n  default privileges — the table nobody has written yet')

  /* ⚠️ EVERYTHING THAT CREATES A PROBE TABLE LIVES INSIDE THIS try, so the
     `finally` drops them however this exits. */
  try {
    run('create table analytics.gate_probe_one (id int)')
    const anonOne = holds('anon', 'analytics.gate_probe_one')
    ok(anonOne === 'false', 'a NEW table in analytics grants anon no SELECT on arrival', `anon SELECT = ${anonOne}`)
    ok(holds('authenticated', 'analytics.gate_probe_one') === 'false', 'nor authenticated')

    /* THE CONTROL: `false` is also what a probe returns when it is asking the
       wrong question. Install the granting default, make a table, confirm the
       probe SEES it.

       ⚠️ ITS OWN try/finally, AND THE REVOKE IS UNCONDITIONAL. Between these
       two lines production is in the state this gate exists to detect. If the
       assertion throws, or the connection drops, the `finally` is the only
       thing standing between a diagnostic and a permanent grant — one that the
       next run would misread as an event trigger and halt the deploy on. */
    try {
      run('alter default privileges in schema analytics grant select on tables to anon')
      run('create table analytics.gate_probe_two (id int)')
      ok(holds('anon', 'analytics.gate_probe_two') === 'true',
        'CONTROL: with a granting default installed, the probe DOES see the grant — so the `false`s above are answers, not blind spots')
    } finally {
      cleanupControl('control')
    }

    console.log('\n  the seven event names')
    const names = run(`select string_agg(enumlabel,', ' order by enumsortorder)
      from pg_enum e join pg_type t on t.oid=e.enumtypid
      join pg_namespace n on n.oid=t.typnamespace
      where t.typname='event_name' and n.nspname='analytics'`)
    ok(names.split(', ').length === 7, 'seven, including source_link_click', names)

  /**
   * ⚠️ 19. DEFAULT ACL OR EVENT TRIGGER — THE QUESTION ONLY PRODUCTION SETTLES.
   *
   * `alter default privileges` counters ONE mechanism: the default ACL. If
   * hosted Supabase instead grants on new tables via an EVENT TRIGGER, our
   * REVOKE is inert and the trigger wins — silently, and only here. The local
   * scratch gate cannot see this at all; there is no trigger on a bare cluster.
   *
   * So: a table created in the most ordinary way possible, then the direct
   * question. If anon comes back TRUE this is migration 002's finding repeating
   * in a new schema — grants arriving from somewhere other than our migration —
   * and it changes the design rather than needing a patch.
   */
    console.log('\n  19. THE PROD-ONLY QUESTION: default ACL, or an event trigger?')
    run('create table analytics.gate_probe_three (id int)')
    const anonFinal = holds('anon', 'analytics.gate_probe_three')
    const authFinal = holds('authenticated', 'analytics.gate_probe_three')
    const triggers = run(`select coalesce(string_agg(evtname, ', '), 'none') from pg_event_trigger`)
    /* Read AFTER the control's finally, so a granting default showing up here
       is Supabase's and not ours. */
    const defacl = grantingDefault()
    console.log(`      event triggers on this cluster: ${triggers}`)
    console.log(`      default ACL on analytics:       ${defacl}`)
    ok(anonFinal === 'false' && authFinal === 'false',
      'a brand-new analytics table is closed to anon AND authenticated on production',
      `anon=${anonFinal} authenticated=${authFinal}`)

    if (anonFinal !== 'false') {
      console.error(
        `\n  ⚠️  STOP. anon holds SELECT on a table our migration never granted on.`
        + `\n      This is migration 002's finding repeating in the analytics schema:`
        + `\n      privileges are arriving from something other than this migration`
        + `\n      (event trigger '${triggers}'), so \`alter default privileges\` is`
        + `\n      inert here and every future table in this schema is open by`
        + `\n      default. DO NOT PROCEED — this changes the design, not a line.`
        + `\n\n      Before believing it: the cleanup lines above must both report`
        + `\n      clean. A leftover granting default from an earlier crashed run`
        + `\n      produces exactly this reading.\n`,
      )
    }
  } finally {
    cleanupProbeTables('probe tables')
  }
} finally {
  /* ⚠️ BELT AND BRACES. Both cleanups run AGAIN here, unconditionally and
     idempotently, so a crash before either inner block was even reached still
     leaves production clean. Running them twice costs two statements and
     removes an entire class of "it only leaks when it fails" bug. */
  cleanupControl('outer')
  cleanupProbeTables('outer')

  /* ⚠️ ALWAYS, INCLUDING ON FAILURE — and ONLY what was borrowed. Printed
     either way so a half-run leaves evidence of what is still outstanding. */
  if (!borrowedMembership) {
    console.log('\n  (membership pre-existed and was left as found — nothing to return)')
  } else {
    try {
      run('revoke cid_events_writer from postgres')
      console.log('\n  REVOKE  cid_events_writer FROM postgres  (membership returned)')
      /* ⚠️ VERIFIED BY CAPABILITY, THE SAME WAY IT WAS DECIDED. Counting rows in
         pg_auth_members would report the PLATFORM's SET-FALSE membership as a
         leftover and fail a clean run — the original bug wearing a different
         hat. What must be true afterwards is that postgres can no longer
         `set role`, i.e. we gave back exactly what we took. */
      const stillCan = canSetRole()
      const rows = run(
        `select count(*) from pg_auth_members m
         join pg_roles r on r.oid = m.roleid join pg_roles g on g.oid = m.member
         where r.rolname='cid_events_writer' and g.rolname='postgres'`)
      console.log(`          verified: SET ROLE now ${stillCan ? 'STILL POSSIBLE' : 'refused again'}`
        + ` (${rows} platform membership row(s) left untouched)`)
      if (stillCan) {
        console.error('  ⚠️  POSTGRES CAN STILL SET ROLE — the borrowed grant was not returned.'
          + '\n      Paste this:\n        revoke cid_events_writer from postgres;')
        failed++
      }
    } catch (e) {
      console.error(`\n  ⚠️  THE REVOKE DID NOT HAPPEN — postgres is still a member of`
        + `\n      cid_events_writer. Run this by hand:`
        + `\n        revoke cid_events_writer from postgres;`
        + `\n      (${redact(e.message ?? e)})\n`)
      failed++
    }
  }
}

console.log(`\n  ${failed} failed\n`)
process.exit(failed ? 1 : 0)
