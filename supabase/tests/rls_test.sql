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

select plan(51);

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
  ('room_waitlist','public_read'),
  ('room_formats','public_read'),
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
insert into public.pending_changes (target_table, target_id, room_id, field, old_value, new_value, agent, source_url)
select 'cash_games', c.id, c.room_id, 'rake_cap', to_jsonb(c.rake_cap), to_jsonb(9), 'pgtap-matched',
       'https://example.test/matched'
  from public.cash_games c where c.rake_cap is not null and c.rake_verified_at is null
  and not exists (select 1 from public.pending_changes p where p.target_id = c.id)
 order by c.id
 limit 1;
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

-- ---------------------------------------------------------------------
-- 7. THE TWO NEW TABLES, at both layers.
--
-- The classification guard above already forces a read decision for
-- these, and tests 3 and 4 exercise it. What it CANNOT see is the write
-- side, in either direction — so both are asserted here.
-- ---------------------------------------------------------------------
select ok(
  not pg_temp.works_as('anon',
    $$ insert into public.room_waitlist (room_id, vendor)
       values ((select id from public.rooms where slug='aria'), 'bravo') $$),
  'anon is refused INSERT on room_waitlist'
);

select ok(
  not pg_temp.works_as('anon',
    $$ insert into public.room_formats (room_id, slug)
       values ((select id from public.rooms where slug='aria'), 'anon-injected') $$),
  'anon is refused INSERT on room_formats'
);

-- SERVICE_ROLE'S GRANT DOES NOT ARRIVE BY ITSELF, and this is the test
-- that says so. The initial schema's `grant ... on all tables ... to
-- service_role` covered the tables existing that day and does not reach
-- forward; `rolbypassrls` bypasses policies, never table privileges. So
-- a table added without an explicit grant is readable by the public and
-- unwritable by the one role meant to maintain it — a shape no existing
-- assertion catches, because `admins` (migration 4) has exactly that gap
-- today and is only ever touched through a SECURITY DEFINER function.
select ok(
  pg_temp.works_as('service_role',
    $$ insert into public.room_waitlist (room_id, vendor)
       values ((select id from public.rooms where slug='skyline'), 'bravo') $$),
  'service_role can write room_waitlist (the forward-grant gap)'
);

select ok(
  pg_temp.works_as('service_role',
    $$ insert into public.room_formats (room_id, slug, label)
       values ((select id from public.rooms where slug='aria'), 'pgtap-probe', 'probe') $$),
  'service_role can write room_formats (the forward-grant gap)'
);

-- =====================================================================
-- 10. INTAKE PHASE I (migration 6) — the queue as the only write path.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 10a. room_amenities kept its RLS, its policy and its grants across the
--      primary-key swap.
-- ---------------------------------------------------------------------
-- Migration 6 drops the (room_id, amenity_id) primary key and adds one on a new
-- surrogate `id`. Policies and grants attach to the TABLE and not to the
-- constraint, so they SHOULD survive untouched — and "should survive" is
-- precisely the reasoning that once left this project with twelve correct
-- policies and an API that answered 42501 to everything. Asserted, not assumed.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.room_amenities'::regclass)
  and exists (select 1 from pg_policy where polrelid = 'public.room_amenities'::regclass)
  and pg_temp.works_as('anon', 'select 1 from public.room_amenities limit 1'),
  'room_amenities kept RLS, its policy and anon SELECT across the primary-key swap'
);

-- The natural key must still be enforced, or one room can hold two answers to
-- the same amenity question — and the seed's `on conflict (room_id, amenity_id)`
-- would have nothing to conflict on.
select ok(
  exists (
    select 1 from pg_constraint
     where conrelid = 'public.room_amenities'::regclass
       and contype = 'u'
       and pg_get_constraintdef(oid) = 'UNIQUE (room_id, amenity_id)'
  ),
  '(room_id, amenity_id) survives as UNIQUE after being demoted from primary key'
);

-- ---------------------------------------------------------------------
-- 10b. A proposal against room_amenities now APPLIES.
-- ---------------------------------------------------------------------
-- It used to be refused loudly because the table had no single-column id to
-- name. The refusal was correct then and would be a bug now.
insert into public.pending_changes (target_table, target_id, room_id, field, old_value, new_value, agent, source_id, source_url)
select 'room_amenities', ra.id, ra.room_id, 'available', to_jsonb(ra.available), to_jsonb(false), 'pgtap-amen',
       (select id from public.sources where data_type = 'cash' limit 1), 'https://example.test/amen'
  from public.room_amenities ra where ra.verified_at is null
   and not exists (select 1 from public.pending_changes p where p.target_id = ra.id)
 order by ra.id
 limit 1;
select ok(
  pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change((select id from public.pending_changes where agent='pgtap-amen' limit 1)) $$),
  'a proposal against room_amenities is applied now that the row is addressable'
);

-- ---------------------------------------------------------------------
-- 10c. THE WESTGATE MISATTRIBUTION CLASS APPLIES TO THIS TABLE TOO.
-- ---------------------------------------------------------------------
-- A valid amenity id belonging to a different room than the proposal names.
insert into public.pending_changes (target_table, target_id, room_id, field, old_value, new_value, agent)
select 'room_amenities', ra.id,
       (select r.id from public.rooms r where r.id <> ra.room_id limit 1),
       'available', to_jsonb(ra.available), to_jsonb(false), 'pgtap-amen-mismatch'
  from public.room_amenities ra
   where not exists (select 1 from public.pending_changes p where p.target_id = ra.id)
 order by ra.id
 limit 1;
select ok(
  not pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change(
         (select id from public.pending_changes where agent='pgtap-amen-mismatch' limit 1), true) $$),
  'an amenity proposal whose target row belongs to a different room is refused'
);

-- ---------------------------------------------------------------------
-- 10d. THE FLOOR-STAMP PATH, BOTH DIRECTIONS.
-- ---------------------------------------------------------------------
-- A verification stamp means a person stood in the room. The gate is the
-- data_type of the source the proposal CITES, joined inside the definer
-- function — never a parameter and never a flag in the payload, because either
-- would let the writer of a proposal certify their own proposal.

-- WEB source + stamp -> refused, with the original denylist error.
insert into public.pending_changes (target_table, target_id, room_id, field, old_value, new_value, agent, source_id)
select 'room_amenities', ra.id, ra.room_id, 'verified_at', 'null'::jsonb, to_jsonb(now()::text), 'pgtap-stamp-web',
       (select id from public.sources where data_type = 'cash' limit 1)
  from public.room_amenities ra where ra.verified_at is null
   and not exists (select 1 from public.pending_changes p where p.target_id = ra.id)
 order by ra.id
 limit 1;
select ok(
  not pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change(
         (select id from public.pending_changes where agent='pgtap-stamp-web' limit 1), true) $$),
  'a stamp proposal citing a WEB source is refused'
);

-- FLOOR source + stamp -> applies. Without this control the test above would
-- pass just as well if stamps were refused outright, which is the old behaviour.
insert into public.pending_changes (target_table, target_id, room_id, field, old_value, new_value, agent, source_id)
select 'room_amenities', ra.id, ra.room_id, 'verified_at', 'null'::jsonb, to_jsonb(now()::text), 'pgtap-stamp-floor',
       (select id from public.sources where data_type = 'floor' limit 1)
  from public.room_amenities ra where ra.verified_at is null
   and not exists (select 1 from public.pending_changes p where p.target_id = ra.id)
 order by ra.id
 limit 1;
select ok(
  pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change(
         (select id from public.pending_changes where agent='pgtap-stamp-floor' limit 1), true) $$),
  'a stamp proposal citing a FLOOR source is applied'
);

-- STAMPS ARE OPTIONAL, NOT IMPLIED. A floor source does not mean every
-- proposal from it silently acquires a verification stamp; it means one is
-- PERMITTED when the proposal actually carries it.
insert into public.pending_changes (target_table, target_id, room_id, field, old_value, new_value, agent, source_id, source_url)
select 'room_amenities', ra.id, ra.room_id, 'available', to_jsonb(ra.available), to_jsonb(false), 'pgtap-floor-nostamp',
       (select id from public.sources where data_type = 'floor' limit 1), 'https://example.test/nostamp'
  from public.room_amenities ra where ra.verified_at is null
   and not exists (select 1 from public.pending_changes p where p.target_id = ra.id)
 order by ra.id
 limit 1;
select ok(
  pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change(
         (select id from public.pending_changes where agent='pgtap-floor-nostamp' limit 1), true) $$)
  and (select verified_at is null from public.room_amenities ra
        where ra.id = (select target_id from public.pending_changes where agent='pgtap-floor-nostamp' limit 1)),
  'a floor-sourced proposal WITHOUT a stamp applies and does not acquire one'
);

-- ---------------------------------------------------------------------
-- 10e. INSERT PROPOSALS.
-- ---------------------------------------------------------------------
-- Horseshoe has no massage row at all, which is the case an insert exists for:
-- "not checked" becoming "checked, confirmed absent".
insert into public.pending_changes (target_table, target_id, room_id, operation, new_value, agent, source_id, source_url)
select 'room_amenities', null, r.id, 'insert',
       jsonb_build_object(
         'amenity_id', (select id from public.amenity_types where slug = 'massage'),
         'available', false,
         'detail', 'confirmed absent on the floor'),
       'pgtap-insert', (select id from public.sources where data_type = 'floor' limit 1), 'https://example.test/insert'
  from public.rooms r where r.slug = 'horseshoe';

select ok(
  pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change((select id from public.pending_changes where agent='pgtap-insert' limit 1)) $$),
  'an insert proposal creates the row'
);

-- change_log must name the row that was CREATED, or the log cannot be walked
-- back to the fact it produced.
select ok(
  exists (
    select 1 from public.change_log cl
     join public.room_amenities ra on ra.id = cl.target_id
    where cl.agent = 'pgtap-insert' and cl.operation = 'insert' and ra.available = false
  ),
  'change_log records the created row id for an insert'
);

-- AN INSERT MAY NOT SMUGGLE A STAMP PAST THE FLOOR GATE. The payload is a
-- whole row, so every key runs the same check the update path runs — the first
-- sketch of this validated the update field and looped the payload past a
-- shorter list, which is exactly how this hole opens.
insert into public.pending_changes (target_table, target_id, room_id, operation, new_value, agent, source_id, source_url)
select 'room_amenities', null, r.id, 'insert',
       jsonb_build_object(
         'amenity_id', (select id from public.amenity_types where slug = 'usb'),
         'available', true,
         'verified_at', now()::text),
       'pgtap-insert-stamp', (select id from public.sources where data_type = 'cash' limit 1), 'https://example.test/insert-stamp'
  from public.rooms r where r.slug = 'horseshoe';

select ok(
  not pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change((select id from public.pending_changes where agent='pgtap-insert-stamp' limit 1)) $$),
  'an insert citing a web source cannot smuggle a verification stamp'
);

-- An insert may not re-parent itself either: room_id comes from the proposal,
-- never from the payload, so a second copy could only ever disagree.
insert into public.pending_changes (target_table, target_id, room_id, operation, new_value, agent, source_id, source_url)
select 'room_amenities', null, r.id, 'insert',
       jsonb_build_object(
         'amenity_id', (select id from public.amenity_types where slug = 'tvs'),
         'room_id', (select id from public.rooms where slug = 'aria'),
         'available', true),
       'pgtap-insert-reparent', (select id from public.sources where data_type = 'floor' limit 1), 'https://example.test/insert-reparent'
  from public.rooms r where r.slug = 'horseshoe';

select ok(
  not pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change((select id from public.pending_changes where agent='pgtap-insert-reparent' limit 1)) $$),
  'an insert payload carrying room_id is refused rather than re-parenting the new row'
);

-- A ROOM CANNOT BE CREATED THROUGH A PROPOSAL — the roster of 17 is a locked
-- decision, and an insert into `rooms` has no room to belong to.
insert into public.pending_changes (target_table, target_id, room_id, operation, new_value, agent, source_id, source_url)
select 'rooms', null, r.id, 'insert', jsonb_build_object('name', 'Injected Room', 'slug', 'injected'),
       'pgtap-insert-room', (select id from public.sources where data_type = 'floor' limit 1), 'https://example.test/insert-room'
  from public.rooms r where r.slug = 'horseshoe';

select ok(
  not pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change((select id from public.pending_changes where agent='pgtap-insert-room' limit 1)) $$),
  'a proposal cannot create a room'
);
-- =====================================================================
-- 11. THE RECEIPT FOLLOWS THE FACT (revision 1).
-- =====================================================================
-- Approval used to write a new value and leave the OLD citation beside it, so
-- the first queued floor correction produced a row whose source_url pointed at
-- a page contradicting it — the Westgate misattribution class, in the write
-- path, on day one.
--
-- EVERY CASE BELOW IS TWO STATEMENTS: one that performs the approval, one that
-- reads the result. They were written as a single
-- `ok(runs_as(...) and (select ...))` and three of them failed while the
-- function was correct — SQL does not guarantee the evaluation order of AND
-- operands, so Postgres read the row BEFORE the approval that changed it. An
-- assertion whose truth depends on a side effect inside the same expression is
-- not an assertion. Statement order is the only ordering there is.

-- ---------------------------------------------------------------------
-- 11a. A FLOOR CORRECTION TO A VALUE MOVES THE RECEIPT TO THE SHEET.
-- ---------------------------------------------------------------------
insert into public.pending_changes (target_table, target_id, room_id, field, old_value, new_value, agent, source_id, source_url)
select 'cash_games', c.id, c.room_id, 'rake_cap', to_jsonb(c.rake_cap), to_jsonb(4), 'pgtap-receipt-floor',
       (select id from public.sources where data_type = 'floor' limit 1),
       'https://docs.google.com/spreadsheets/d/PGTAP/edit'
  from public.cash_games c
 where c.rake_cap is not null and c.rake_verified_at is null and c.rake_type = 'pot'
   and not exists (select 1 from public.pending_changes p where p.target_id = c.id)
 order by c.id
 limit 1;

select ok(
  pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change((select id from public.pending_changes where agent='pgtap-receipt-floor' limit 1)) $$),
  'a floor correction to a rake value is applied'
);

select is(
  (select c.rake_source_url from public.cash_games c
    where c.id = (select target_id from public.pending_changes where agent='pgtap-receipt-floor' limit 1)),
  'https://docs.google.com/spreadsheets/d/PGTAP/edit',
  '...and the RAKE receipt moved to the sheet the proposal cites'
);

-- The rake family moves; the ROW's own citation does not. This is the split
-- that lets Orleans cite Boyd for its stakes and a third party for its cap.
select isnt(
  (select c.source_url from public.cash_games c
    where c.id = (select target_id from public.pending_changes where agent='pgtap-receipt-floor' limit 1)),
  'https://docs.google.com/spreadsheets/d/PGTAP/edit',
  '...while the row-level stakes citation is left alone'
);

-- ---------------------------------------------------------------------
-- 11b. A STAMP-ONLY PROPOSAL MOVES NO RECEIPT (corroboration).
-- ---------------------------------------------------------------------
-- 4a55228, as code: the partner confirming a figure we already hold changes no
-- number, so it re-sources nothing. South Point kept its Vegas Advantage
-- citation through a floor verification and this path must reach that answer.
insert into public.pending_changes (target_table, target_id, room_id, field, old_value, new_value, agent, source_id, source_url)
select 'room_amenities', ra.id, ra.room_id, 'verified_at', 'null'::jsonb, to_jsonb(now()::text), 'pgtap-corroborate',
       (select id from public.sources where data_type = 'floor' limit 1),
       'https://docs.google.com/spreadsheets/d/PGTAP/edit'
  from public.room_amenities ra
 where ra.verified_at is null and ra.source_url is not null
   and not exists (select 1 from public.pending_changes p where p.target_id = ra.id)
 order by ra.id
 limit 1;

select ok(
  pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change((select id from public.pending_changes where agent='pgtap-corroborate' limit 1)) $$),
  'a stamp-only floor proposal is applied'
);

select ok(
  (select ra.verified_at is not null and ra.source_url not like '%docs.google.com%'
     from public.room_amenities ra
    where ra.id = (select target_id from public.pending_changes where agent='pgtap-corroborate' limit 1)),
  '...it sets the stamp and does NOT re-source the figure — a corroboration is not a re-sourcing'
);

-- ---------------------------------------------------------------------
-- 11c. CHILD PROVENANCE APPLIES TO RESEARCH TOO.
-- ---------------------------------------------------------------------
-- A detector-shaped web proposal is not exempt: if it changes the number, the
-- row must cite ITS page. The rule is about where a fact came from, not about
-- whose data is better.
insert into public.pending_changes (target_table, target_id, room_id, field, old_value, new_value, agent, source_id, source_url)
select 'cash_games', c.id, c.room_id, 'rake_cap', to_jsonb(c.rake_cap), to_jsonb(7), 'pgtap-receipt-web',
       (select id from public.sources where data_type = 'cash' limit 1),
       'https://vegasadvantage.com/pgtap-detector'
  from public.cash_games c
 where c.rake_cap is not null and c.rake_verified_at is null and c.rake_type = 'pot'
   and not exists (select 1 from public.pending_changes p where p.target_id = c.id)
 order by c.id
 limit 1;

select ok(
  pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change((select id from public.pending_changes where agent='pgtap-receipt-web' limit 1)) $$),
  'a web detector proposal is applied'
);

select is(
  (select c.rake_source_url from public.cash_games c
    where c.id = (select target_id from public.pending_changes where agent='pgtap-receipt-web' limit 1)),
  'https://vegasadvantage.com/pgtap-detector',
  '...and it too moves the receipt to its own page — child provenance is not only for the partner'
);

-- ---------------------------------------------------------------------
-- 11d. AN INSERT IS BORN CITING THE PROPOSAL, AND NEVER UNCITED.
-- ---------------------------------------------------------------------
-- CASH_GAMES, not room_amenities: the 10e insert test exercised the amenity
-- table, and `cash_games.source_url` is NULLABLE — so before this fix an
-- uncited game row would have been created SILENTLY rather than failing. The
-- quiet version of the bug needs the loud test.
insert into public.pending_changes (target_table, target_id, room_id, operation, new_value, agent, source_id, source_url)
select 'cash_games', null, r.id, 'insert',
       jsonb_build_object('game', 'nlh', 'stakes_label', '$2/5 pgtap', 'rake_type', 'pot', 'rake_cap', 5),
       'pgtap-insert-cash', (select id from public.sources where data_type = 'floor' limit 1),
       'https://docs.google.com/spreadsheets/d/PGTAP/edit'
  from public.rooms r where r.slug = 'horseshoe';

select ok(
  pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change((select id from public.pending_changes where agent='pgtap-insert-cash' limit 1)) $$),
  'an insert proposal against cash_games is applied'
);

select ok(
  (select c.source_url = 'https://docs.google.com/spreadsheets/d/PGTAP/edit' and c.fetched_at is not null
     from public.cash_games c where c.stakes_label = '$2/5 pgtap'),
  '...and the created row carries the PROPOSAL''s citation, written by the function'
);

-- Uncited insert: refused. `source_url` is nullable on every target table, so
-- nothing but this check stands between a proposal and a fact with no receipt.
insert into public.pending_changes (target_table, target_id, room_id, operation, new_value, agent, source_id)
select 'cash_games', null, r.id, 'insert',
       jsonb_build_object('game', 'nlh', 'stakes_label', '$9/9 uncited'),
       'pgtap-insert-uncited', (select id from public.sources where data_type = 'floor' limit 1)
  from public.rooms r where r.slug = 'horseshoe';

select ok(
  not pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change((select id from public.pending_changes where agent='pgtap-insert-uncited' limit 1)) $$),
  'an insert proposal citing no source is refused'
);

select is_empty(
  $$ select 1 from public.cash_games where stakes_label = '$9/9 uncited' $$,
  '...and creates nothing'
);

-- Same rule on the update side: a value cannot change without a citation for
-- the new value, or the receipt move would trade a contradicting receipt for
-- no receipt at all.
insert into public.pending_changes (target_table, target_id, room_id, field, old_value, new_value, agent)
select 'cash_games', c.id, c.room_id, 'rake_cap', to_jsonb(c.rake_cap), to_jsonb(3), 'pgtap-update-uncited'
  from public.cash_games c
 where c.rake_cap is not null and c.rake_verified_at is null
   and not exists (select 1 from public.pending_changes p where p.target_id = c.id)
 order by c.id
 limit 1;

select ok(
  not pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change((select id from public.pending_changes where agent='pgtap-update-uncited' limit 1)) $$),
  'an update proposal that changes a value but cites no source is refused'
);

-- ---------------------------------------------------------------------
-- 11e. THE RECEIPT MOVE OPENED NO PAYLOAD DOOR.
-- ---------------------------------------------------------------------
-- The move reads pc.source_url — proposal metadata — and the payload may not
-- carry a citation at all. Re-run in both operations, because the whole risk of
-- this revision is that "the function writes provenance now" quietly becomes
-- "provenance is writable".
insert into public.pending_changes (target_table, target_id, room_id, operation, new_value, agent, source_id, source_url)
select 'room_amenities', null, r.id, 'insert',
       jsonb_build_object(
         'amenity_id', (select id from public.amenity_types where slug = 'checkcash'),
         'available', true,
         'source_url', 'https://evil.test/payload'),
       'pgtap-insert-payload-cite', (select id from public.sources where data_type = 'floor' limit 1),
       'https://docs.google.com/spreadsheets/d/PGTAP/edit'
  from public.rooms r where r.slug = 'horseshoe';

select ok(
  not pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change((select id from public.pending_changes where agent='pgtap-insert-payload-cite' limit 1)) $$),
  'an insert payload carrying source_url is refused — the citation is not a payload field'
);

insert into public.pending_changes (target_table, target_id, room_id, field, old_value, new_value, agent, source_id, source_url)
select 'room_amenities', ra.id, ra.room_id, 'source_url', 'null'::jsonb, to_jsonb('https://evil.test/update'::text),
       'pgtap-update-payload-cite', (select id from public.sources where data_type = 'floor' limit 1),
       'https://docs.google.com/spreadsheets/d/PGTAP/edit'
  from public.room_amenities ra
 where not exists (select 1 from public.pending_changes p where p.target_id = ra.id)
 order by ra.id
 limit 1;

select ok(
  not pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    $$ select public.approve_change((select id from public.pending_changes where agent='pgtap-update-payload-cite' limit 1), true) $$),
  'an update proposing source_url as a field is refused — two mechanisms may not fight over one column'
);

select is_empty(
  $$ select 1 from public.room_amenities where source_url like 'https://evil.test/%' $$,
  'no payload-supplied citation reached a fact row, by either operation'
);

select * from finish();
rollback;
