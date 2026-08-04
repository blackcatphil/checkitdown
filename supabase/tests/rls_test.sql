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

select plan(10);

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
