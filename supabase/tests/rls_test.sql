-- =====================================================================
-- RLS + GRANTS — behavioural test.   run:  supabase test db
-- =====================================================================
-- This exists because structural verification has now twice come back
-- clean while behaviour was broken. The worst case cost us the entire
-- API: 12 correct policies, RLS on all 15 tables, zero migration errors,
-- and PostgREST answering 42501 to every request for anon AND for
-- service_role, because a migration that creates tables in `public`
-- grants them no SELECT by default.
--
-- A note saying "future migrations must add their own grants" would be
-- forgotten by whoever adds table sixteen. So the FIRST test below fails
-- when a relation appears in `public` that this file does not classify.
-- Adding a table without deciding whether the public may read it is
-- therefore a failing build, not an oversight.
--
-- Deliberately NOT solved with ALTER DEFAULT PRIVILEGES: auto-granting
-- SELECT to anon would make the next pending_changes-shaped table
-- silently world-readable. A forgotten grant fails loudly here; a
-- forgotten revoke would leak quietly. Explicit grants force a decision.
-- =====================================================================
begin;
create extension if not exists pgtap;

select plan(20);

-- ---------------------------------------------------------------------
-- The classification. Every relation in public must appear exactly once.
--   public_read  — anon may SELECT
--   service_only — anon may not even SELECT
--   write_only   — anon may INSERT but never SELECT
-- ---------------------------------------------------------------------
create temp table expected_access(relname text primary key, access text not null);
insert into expected_access(relname, access) values
  ('markets','public_read'),
  ('rooms','public_read'),
  ('cash_games','public_read'),
  ('amenity_types','public_read'),
  ('room_amenities','public_read'),
  ('house_rules','public_read'),
  ('tournament_series','public_read'),
  ('tournament_templates','public_read'),
  ('tournament_levels','public_read'),
  ('tournament_instances','public_read'),
  ('promotions','public_read'),
  ('room_freshness','public_read'),
  ('source_kinds','public_read'),
  ('pending_review','service_only'),
  ('admins','service_only'),
  ('sources','service_only'),
  ('pending_changes','service_only'),
  ('change_log','service_only'),
  ('corrections','write_only');

-- Probe a statement as a given role. Only a privilege error counts as
-- "refused" — anything else propagates, so a broken test fails loudly
-- rather than quietly reporting a denial it did not actually observe.
create or replace function pg_temp.works_as(as_role text, stmt text)
returns boolean language plpgsql as $$
begin
  execute format('set local role %I', as_role);
  execute stmt;
  reset role;
  return true;
exception when insufficient_privilege then
  reset role;
  return false;
end $$;

-- Probe as a SIGNED-IN user, which `works_as` cannot express: admin identity
-- lives in the JWT, so the claims have to travel with the role.
--
-- Returns -1 when the statement is REFUSED outright and a row count otherwise,
-- because those are different failures and conflating them is how an RLS test
-- passes while a policy does nothing. A missing grant raises; a policy that
-- filters everything returns zero rows quietly.
create or replace function pg_temp.count_as(as_role text, claims jsonb, stmt text)
returns int language plpgsql as $$
declare n int;
begin
  execute format('set local role %I', as_role);
  perform set_config('request.jwt.claims', claims::text, true);
  execute stmt into n;
  perform set_config('request.jwt.claims', null, true);
  reset role;
  return n;
exception when insufficient_privilege then
  perform set_config('request.jwt.claims', null, true);
  reset role;
  return -1;
end $$;

create or replace function pg_temp.runs_as(as_role text, claims jsonb, stmt text)
returns boolean language plpgsql as $$
begin
  execute format('set local role %I', as_role);
  perform set_config('request.jwt.claims', claims::text, true);
  execute stmt;
  perform set_config('request.jwt.claims', null, true);
  reset role;
  return true;
exception when others then
  perform set_config('request.jwt.claims', null, true);
  reset role;
  return false;
end $$;

-- THE TEST MAKES ITS OWN ADMIN. The allowlist is operational data and lives
-- outside the repo, so nothing here may depend on a real person's address —
-- a public repo whose suite only passes for one human is a broken suite.
-- Rolled back with the rest of the transaction.
insert into public.admins (email, note) values ('admin@example.test', 'pgtap fixture');

-- One proposal to triage, so the admin tests have something to see. Targets a
-- rake figure the partner verified in person, which is the interesting case.
insert into public.pending_changes (target_table, target_id, room_id, field, old_value, new_value, source_url, agent, confidence)
select 'cash_games', c.id, c.room_id, 'rake_cap', to_jsonb(c.rake_cap), to_jsonb(8), 'https://example.test/rake', 'pgtap', 0.9
  from public.cash_games c
 where c.rake_verified_at is not null
 limit 1;

-- ---------------------------------------------------------------------
-- 1. Nothing unclassified. This is the guard that survives staff turnover.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r','v')
        and c.relname not in (select relname from expected_access) $$,
  'every relation in public is classified public_read / service_only / write_only'
);

-- ...and nothing classified that no longer exists, so the list cannot rot.
select is_empty(
  $$ select e.relname from expected_access e
      where not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname='public' and c.relkind in ('r','v') and c.relname = e.relname) $$,
  'every classified relation still exists (no stale entries)'
);

-- ---------------------------------------------------------------------
-- 2. RLS is on everywhere. Necessary but not sufficient — see 3 and 4.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relkind='r' and not c.relrowsecurity $$,
  'row level security is enabled on every table in public'
);

-- ---------------------------------------------------------------------
-- 3. anon CAN read everything public. This is the test that would have
--    caught the missing grants in seconds.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select relname from expected_access
      where access = 'public_read'
        and not pg_temp.works_as('anon', format('select 1 from public.%I limit 1', relname)) $$,
  'anon can SELECT every public_read relation'
);

-- ---------------------------------------------------------------------
-- 4. anon CANNOT read the maintenance loop, nor read back corrections.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select relname from expected_access
      where access in ('service_only','write_only')
        and pg_temp.works_as('anon', format('select 1 from public.%I limit 1', relname)) $$,
  'anon is refused SELECT on every service_only and write_only relation'
);

-- ---------------------------------------------------------------------
-- 5. anon may not write to public content.
-- ---------------------------------------------------------------------
select ok(
  not pg_temp.works_as('anon',
    $$ insert into public.rooms (market_id, slug, name, area, latitude, longitude)
       values ((select id from public.markets limit 1),'anon-injected','x','strip',36.1,-115.1) $$),
  'anon is refused INSERT on rooms'
);

-- ---------------------------------------------------------------------
-- 5b. THE ADMIN LOOP. anon gains nothing, and — the case nobody writes by
--     default — a signed-in NON-admin gains nothing either.
-- ---------------------------------------------------------------------
select is(
  pg_temp.count_as('anon', '{"email":"stranger@example.test"}'::jsonb,
                   'select count(*)::int from public.pending_changes'),
  -1,
  'anon is REFUSED outright on pending_changes (no grant, not merely filtered)'
);

select is(
  pg_temp.count_as('authenticated', '{"email":"stranger@example.test"}'::jsonb,
                   'select count(*)::int from public.pending_changes'),
  0,
  'a signed-in NON-admin can reach pending_changes and sees nothing in it'
);

select is(
  pg_temp.count_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
                   'select count(*)::int from public.pending_changes'),
  1,
  'a signed-in ADMIN sees the queue'
);

select is(
  pg_temp.count_as('authenticated', '{"email":"stranger@example.test"}'::jsonb,
                   'select count(*)::int from public.pending_review'),
  0,
  'the review VIEW carries the caller''s identity too — a non-admin sees nothing'
);

-- An UPDATE filtered by policy touches zero rows rather than raising, so the
-- assertion has to count rows changed, not catch an error.
select is(
  pg_temp.count_as('authenticated', '{"email":"stranger@example.test"}'::jsonb,
                   $$ with u as (update public.pending_changes set state='approved' returning 1)
                      select count(*)::int from u $$),
  0,
  'a signed-in non-admin updates no rows in pending_changes'
);

select ok(
  not pg_temp.runs_as('authenticated', '{"email":"stranger@example.test"}'::jsonb,
                      'select public.approve_change((select id from public.pending_changes limit 1))'),
  'a signed-in non-admin cannot call approve_change'
);

-- THE PRECEDENCE RULE, asserted rather than described: the partner's floor data
-- is not overwritten by a proposal unless the reviewer says so explicitly.
select ok(
  not pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
                      'select public.approve_change((select id from public.pending_changes limit 1))'),
  'even an ADMIN cannot approve over a person-verified fact without an explicit override'
);

-- ---------------------------------------------------------------------
-- 5c. WHAT A PROPOSAL MAY NOT TOUCH. Structural, not social.
-- ---------------------------------------------------------------------
-- Validating `field` against the catalogue proves a column EXISTS. These are
-- all catalogue-valid, so without an explicit denylist a scraper could propose
-- a verification stamp and an approval would write it — research setting
-- verified_at, which the seeding rule forbids everywhere else.
insert into public.pending_changes (target_table, target_id, room_id, field, old_value, new_value, agent)
select 'cash_games', c.id, c.room_id, 'rake_verified_at', 'null'::jsonb, to_jsonb(now()), 'pgtap'
  from public.cash_games c where c.rake_verified_at is not null limit 1;

select ok(
  not pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change(
         (select id from public.pending_changes where field='rake_verified_at' limit 1), true) $$),
  'an admin WITH override still cannot approve a proposal that writes a verification stamp'
);

-- ---------------------------------------------------------------------
-- 5d. THE TARGET ROW MUST BELONG TO THE ROOM THE PROPOSAL NAMES.
-- ---------------------------------------------------------------------
-- A valid FK pointing at the wrong document — the Westgate provenance bug, now
-- in the write path. Left unchecked it updates one room's fact, logs it against
-- another, and revalidates a third page: every artefact internally consistent
-- and collectively wrong.
insert into public.pending_changes (target_table, target_id, room_id, field, old_value, new_value, agent)
select 'cash_games', c.id,
       (select r.id from public.rooms r where r.id <> c.room_id limit 1),
       'rake_cap', to_jsonb(c.rake_cap), to_jsonb(9), 'pgtap-mismatch'
  from public.cash_games c where c.rake_cap is not null limit 1;

select ok(
  not pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change(
         (select id from public.pending_changes where agent='pgtap-mismatch' limit 1), true) $$),
  'a proposal whose target row belongs to a different room is refused'
);

-- And the honest control: the SAME shape, correctly parented, is accepted.
-- Without this the test above would pass just as well if approve_change were
-- broken outright.
insert into public.pending_changes (target_table, target_id, room_id, field, old_value, new_value, agent)
select 'cash_games', c.id, c.room_id, 'rake_cap', to_jsonb(c.rake_cap), to_jsonb(9), 'pgtap-matched'
  from public.cash_games c where c.rake_cap is not null and c.rake_verified_at is null limit 1;

select ok(
  pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change(
         (select id from public.pending_changes where agent='pgtap-matched' limit 1)) $$),
  'a correctly parented proposal on an unverified fact IS applied'
);

-- ---------------------------------------------------------------------
-- 6. corrections is submit-only: INSERT yes, SELECT no (covered above).
-- ---------------------------------------------------------------------
select ok(
  pg_temp.works_as('anon',
    $$ insert into public.corrections (message) values ('pgtap probe') $$),
  'anon can INSERT a correction'
);

-- ---------------------------------------------------------------------
-- 7-9. service_role: BYPASSRLS skips the policy, it does NOT confer the
--      privilege, so these must be asserted separately from anon's.
-- ---------------------------------------------------------------------
select ok(
  pg_temp.works_as('service_role', 'select 1 from public.sources limit 1'),
  'service_role can read sources'
);

select ok(
  pg_temp.works_as('service_role', 'select 1 from public.corrections limit 1'),
  'service_role can read corrections'
);

select ok(
  pg_temp.works_as('service_role',
    $$ update public.rooms set comp_notes = comp_notes where slug = 'aria' $$),
  'service_role can write rooms'
);

select * from finish();
rollback;
