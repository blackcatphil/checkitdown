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

select plan(107);

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
  ('room_descriptions','public_read'),
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
   /* AND WEB-RANKED — `rake_verified_at is null` is not the same test. Bellagio's
      rake carries no stamp but cites the floor sheet, so it ranks floor and a
      web proposal is refused by PRECEDENCE before this assertion's real subject
      is reached. Passed by luck for two runs because the row was drawn at
      random from a gen_random_uuid() ordering. */
   and public.fact_source_kind('cash_games', c.id, 'rake_cap') = 'web'
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
   /* AND WEB-RANKED. `verified_at is null` is NOT the rank test: the three
      review-sourced amenity rows added on 2026-08-09 carry no stamp and cite a
      floor document, so they rank floor and a web proposal onto them is refused
      by PRECEDENCE before this assertion's real subject is reached. Which row
      gets drawn depends on a gen_random_uuid() ordering, so this failed about
      one run in three — on a correct database, for a reason unrelated to what
      it tests. */
   and public.fact_source_kind('room_amenities', ra.id, 'available') = 'web'
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
   /* AND WEB-RANKED. `verified_at is null` is NOT the rank test: the three
      review-sourced amenity rows added on 2026-08-09 carry no stamp and cite a
      floor document, so they rank floor and a web proposal onto them is refused
      by PRECEDENCE before this assertion's real subject is reached. Which row
      gets drawn depends on a gen_random_uuid() ordering, so this failed about
      one run in three — on a correct database, for a reason unrelated to what
      it tests. */
   and public.fact_source_kind('room_amenities', ra.id, 'available') = 'web'
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
   /* AND WEB-RANKED. `verified_at is null` is NOT the rank test: the three
      review-sourced amenity rows added on 2026-08-09 carry no stamp and cite a
      floor document, so they rank floor and a web proposal onto them is refused
      by PRECEDENCE before this assertion's real subject is reached. Which row
      gets drawn depends on a gen_random_uuid() ordering, so this failed about
      one run in three — on a correct database, for a reason unrelated to what
      it tests. */
   and public.fact_source_kind('room_amenities', ra.id, 'available') = 'web'
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
   /* AND WEB-RANKED. `verified_at is null` is NOT the rank test: the three
      review-sourced amenity rows added on 2026-08-09 carry no stamp and cite a
      floor document, so they rank floor and a web proposal onto them is refused
      by PRECEDENCE before this assertion's real subject is reached. Which row
      gets drawn depends on a gen_random_uuid() ordering, so this failed about
      one run in three — on a correct database, for a reason unrelated to what
      it tests. */
   and public.fact_source_kind('room_amenities', ra.id, 'available') = 'web'
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
   /* AND WEB-RANKED. `rake_verified_at is null` is NOT the same thing: after the
      2026-08-09 sync Bellagio's rake carries no stamp but DOES cite the floor
      sheet, so it ranks floor and a web proposal onto it is refused by
      precedence before it can be applied. These tests want a row a web source
      may legitimately write. */
   and public.fact_source_kind('cash_games', c.id, 'rake_cap') = 'web'
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
   /* AND WEB-RANKED, so this floor proposal is a floor->web APPLY rather than a
      floor->floor that would need the override. The three review-sourced rows
      rank floor without a stamp, and drawing one made this fail intermittently.
      Same root cause as the other amenity fixtures, different WHERE shape —
      which is why a blanket replace missed it. */
   and public.fact_source_kind('room_amenities', ra.id, 'available') = 'web'
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
   /* AND WEB-RANKED. `rake_verified_at is null` is NOT the same thing: after the
      2026-08-09 sync Bellagio's rake carries no stamp but DOES cite the floor
      sheet, so it ranks floor and a web proposal onto it is refused by
      precedence before it can be applied. These tests want a row a web source
      may legitimately write. */
   and public.fact_source_kind('cash_games', c.id, 'rake_cap') = 'web'
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
   /* AND WEB-RANKED — `rake_verified_at is null` is not the same test. Bellagio's
      rake carries no stamp but cites the floor sheet, so it ranks floor and a
      web proposal is refused by PRECEDENCE before this assertion's real subject
      is reached. Passed by luck for two runs because the row was drawn at
      random from a gen_random_uuid() ordering. */
   and public.fact_source_kind('cash_games', c.id, 'rake_cap') = 'web'
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

-- ---------------------------------------------------------------------
-- ROOM DESCRIPTIONS (migration 007). Prose is a fact like any other: it is
-- publicly readable, it is writable only through the queue, and its citation
-- is written by approve_change rather than proposed.
-- ---------------------------------------------------------------------
select ok(
  pg_temp.works_as('anon', $$ select 1 from public.room_descriptions limit 1 $$),
  'anon may read room_descriptions — prose ships to readers like every other fact'
);

select ok(
  not pg_temp.works_as('anon', $$ insert into public.room_descriptions
      (room_id, body, author_kind, written_at)
      values ((select id from public.rooms limit 1), 'x', 'checkitdown', '2026-08-09') $$),
  'anon may NOT write prose directly — the queue is the only write path'
);

-- ⚠️ NO FIGURES TYPED INTO PROSE, enforced by the schema rather than by a rule
-- somebody has to remember. Asserted as UNREPRESENTABLE: the insert throws.
select throws_ok(
  $$ insert into public.room_descriptions (room_id, body, author_kind, written_at)
     values ((select id from public.rooms limit 1),
             'They spread $1/2 and $2/5 most nights.', 'checkitdown', '2026-08-09') $$,
  '23514',
  null,
  'a typed currency figure in prose is refused by the schema, not merely discouraged'
);

select lives_ok(
  $$ insert into public.room_descriptions (room_id, body, author_kind, written_at)
     values ((select id from public.rooms where slug = 'aria'),
             'The main game is {stakes_lowest} across {table_count} tables.',
             'checkitdown', '2026-08-09') $$,
  'the token form is accepted — a figure reaches prose only by resolving from the room''s own data'
);

select is(
  public.proposal_field_refusal('room_descriptions', 'source_url', false, false),
  'field source_url is provenance or identity and is not writable through a proposal',
  'a description''s citation may not be proposed as a value — the receipt follows the fact here too'
);

select is(
  public.proposal_field_refusal('room_descriptions', 'body', false, false),
  null,
  'body IS writable through a proposal — content ships via the queue, not via a commit'
);

-- =====================================================================
-- THE PRECEDENCE LAW (migration 008). Phil ruled 2026-08-09.
-- =====================================================================
-- THE MATRIX IS ASSERTED CELL BY CELL, not as "precedence works". Each cell is
-- a different decision and they fail independently: the day someone reads
-- `data_type` from the payload instead of from `sources`, floor->web still
-- applies and web->floor silently starts applying too.
--
-- A HELPER THAT BUILDS A PROPOSAL AND TRIES IT, returning the SQLSTATE — so a
-- refusal is distinguished from a crash by code rather than by message text.
create or replace function pg_temp.try_apply(
  p_field text, p_value jsonb, p_source_kind text, p_target uuid, p_override boolean default false
) returns text language plpgsql as $$
declare
  v_id  uuid;
  v_src uuid;
  v_room uuid;
begin
  select room_id into v_room from public.cash_games where id = p_target;
  select id into v_src from public.sources where data_type = p_source_kind limit 1;
  insert into public.pending_changes
    (target_table, target_id, room_id, operation, field, new_value, agent, source_id, source_url)
  values ('cash_games', p_target, v_room, 'update', p_field, p_value, 'pgtap-precedence',
          v_src, (select url from public.sources where id = v_src))
  returning id into v_id;
  /* ROLE AND CLAIMS ARE RESTORED ON BOTH PATHS, the way pg_temp.runs_as does
     it above. The first draft used set_config(..., true) and never reset —
     which is transaction-local, and the whole file is ONE transaction, so
     `authenticated` leaked into every later statement and the next read of a
     temp table died with "permission denied". A helper that changes the
     session has to put it back, on the exception path especially. */
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"email":"admin@example.test"}', true);
    perform public.approve_change(v_id, p_override);
    perform set_config('request.jwt.claims', null, true);
    reset role;
    return 'APPLIED';
  exception when others then
    perform set_config('request.jwt.claims', null, true);
    reset role;
    return sqlstate;
  end;
end $$;

-- Fixtures: one row made floor-sourced (a person stood there), one left web.
/* Same reasoning as the group fixture below: pinned, not drawn at random. */
create temp table pgtap_prec as
  select
    (select c.id from public.cash_games c
       join public.rooms r on r.id = c.room_id
      /* Re-pinned 2026-08-09: South Point's $1/2 was corrected to $1/3 by the
         partner apply, so the old pin selected NOTHING and every assertion below
         silently compared against NULL. */
      where c.rake_verified_at is not null and r.slug = 'aria' and c.stakes_label = '$1/3') as floor_row,
    (select c.id from public.cash_games c
       join public.rooms r on r.id = c.room_id
      where c.rake_verified_at is null and c.rake_type is not null
        /* Bellagio's NLH rake now cites the sheet and ranks FLOOR. Its PLO rows
           were untouched — an unqualified room rake is the no-limit rake — so
           they are what is still web-ranked. */
        and r.slug = 'bellagio' and c.stakes_label = '$1/2 PLO') as web_row,
    /* A SECOND, UNTOUCHED web row. The first draft reused one for both the
       floor->web and web->web cells and web->web then failed with CID03 —
       correctly. The floor write had MOVED THE CITATION to the floor document
       (the receipt follows the fact), so the row was floor-ranked by the time
       the web write arrived. The law was right and the fixture was wrong,
       which is worth keeping as a comment: precedence is a property of the
       fact's current citation, not of the row's history. */
    (select c.id from public.cash_games c
       join public.rooms r on r.id = c.room_id
      where c.rake_verified_at is null and c.rake_type is not null
        and r.slug = 'bellagio' and c.stakes_label = '$2/5 PLO') as web_row_2;

select is(
  public.fact_source_kind('cash_games', (select floor_row from pgtap_prec), 'rake_cap'),
  'floor',
  'a person-verified rake reads as FLOOR even while the row still cites the web page it corroborated'
);

select is(
  public.fact_source_kind('cash_games', (select web_row from pgtap_prec), 'rake_cap'),
  'web',
  'an unstamped rake reads as WEB'
);

-- ─── THE FOUR CELLS ──────────────────────────────────────────────────
select is(
  pg_temp.try_apply('rake_cap', '7'::jsonb, 'floor', (select web_row from pgtap_prec)),
  'APPLIED',
  'PRECEDENCE floor -> web APPLIES — a visit outranks a page'
);

select is(
  pg_temp.try_apply('rake_cap', '8'::jsonb, 'cash', (select web_row_2 from pgtap_prec)),
  'APPLIED',
  'PRECEDENCE web -> web APPLIES — research lands without approval'
);

select is(
  pg_temp.try_apply('rake_cap', '9'::jsonb, 'cash', (select floor_row from pgtap_prec)),
  'CID03',
  'PRECEDENCE web -> floor is REFUSED — floor always trumps web'
);

-- THE CLAUSE THAT MAKES IT PRECEDENCE AND NOT PERMISSION. If the override
-- could lift this, the law would hold exactly until somebody was in a hurry.
select is(
  pg_temp.try_apply('rake_cap', '9'::jsonb, 'cash', (select floor_row from pgtap_prec), true),
  'CID03',
  'web -> floor stays refused WITH the override — no flag outranks a floor visit'
);

select is(
  pg_temp.try_apply('rake_cap', '11'::jsonb, 'floor', (select floor_row from pgtap_prec)),
  'CID03',
  'PRECEDENCE floor -> floor is REFUSED without the override'
);

select is(
  pg_temp.try_apply('rake_cap', '12'::jsonb, 'floor', (select floor_row from pgtap_prec), true),
  'APPLIED',
  'floor -> floor APPLIES with the override — the newer document supersedes the earlier visit'
);

-- ─── THE STAMP FOLLOWS THE LAW ───────────────────────────────────────
select isnt(
  (select rake_verified_at from public.cash_games where id = (select floor_row from pgtap_prec)),
  null,
  'a FLOOR correction keeps the person-verified stamp — a floor document IS somebody having stood there'
);

select is(
  (select rake_verified_at from public.cash_games where id = (select web_row_2 from pgtap_prec)),
  null,
  'and a web write leaves no stamp behind it'
);

-- A FLOOR WRITE PROMOTES THE FACT IT LANDS ON. The receipt follows the fact, so
-- the row now cites the floor document and outranks the web from then on. Found
-- by a fixture that reused one row and got a correct refusal.
select is(
  public.fact_source_kind('cash_games', (select web_row from pgtap_prec), 'rake_cap'),
  'floor',
  'a fact a floor document wrote is FLOOR-ranked afterwards — the receipt moved with the value'
);

-- ─── APPROVAL IS NO LONGER THE ROAD, BUT THE QUEUE IS STILL THERE ────
select has_table('public', 'pending_changes',
  'the queue REMAINS — unused by the normal path, kept for what the law does not cover');
select has_view('public', 'pending_review',
  'and so does the review view a human can still look at');

-- ─── THE GROUPED RAKE TRANSACTION ────────────────────────────────────
-- The constraint makes "this room gains a rake" unrepresentable one field at a
-- time. Asserted as the FAILURE FIRST, so the group's success is known to be
-- doing something rather than to be unnecessary.
select is(
  pg_temp.try_apply('rake_cap', '5'::jsonb, 'floor', /* floor-sourced, see below */
    /* THE SAME PINNED ROW the group test uses below. This line kept its own
       `order by c.id limit 1` after the fixtures were pinned, and stayed flaky
       on its own — one random draw is enough. */
    (select c.id from public.cash_games c
       join public.rooms r on r.id = c.room_id
      /* Re-pinned: Horseshoe GAINED a rake in the apply, so it is no longer
         model-less. Golden Nugget's $4/8 limit is the only such row left and it
         ranks FLOOR, so the proposal must be floor-sourced with the override —
         otherwise precedence refuses first and this never reaches the constraint
         it exists to assert. */
      where c.rake_type is null and r.slug = 'golden-nugget' and c.stakes_label = '$4/8 limit'), true),
  '23514',
  'a cap alone onto a model-less row is refused by rake_model_coherent — which is why groups exist'
);

-- ─── THE GROUP LANDS WHAT SINGLE WRITES CANNOT ───────────────────────
-- The refusal directly above is the control: a cap alone is rejected by the
-- constraint. The same room gaining the SAME rake through a group must succeed,
-- and must succeed as a whole.
create or replace function pg_temp.try_group(p_target uuid, p_override boolean default false)
returns text language plpgsql as $$
declare
  v_room uuid; v_src uuid; v_ids uuid[];
begin
  select room_id into v_room from public.cash_games where id = p_target;
  /* FLOOR-sourced: the only model-less row left ranks floor, so a web proposal
     would be refused by precedence before the constraint under test is ever
     reached. The group tests are about ORDERING, not about precedence. */
  select id into v_src from public.sources where data_type = 'floor' limit 1;
  insert into public.pending_changes
    (target_table, target_id, room_id, operation, field, new_value, agent, source_id, source_url)
  select 'cash_games', p_target, v_room, 'update', f.field, f.val, 'pgtap-group',
         v_src, (select url from public.sources where id = v_src)
    from (values ('rake_cap', '6'::jsonb), ('rake_type', '"pot"'::jsonb), ('rake_percent', '10'::jsonb)) as f(field, val);
  select array_agg(id) into v_ids from public.pending_changes where agent = 'pgtap-group';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"email":"admin@example.test"}', true);
    perform public.approve_change_group(v_ids, p_override);
    perform set_config('request.jwt.claims', null, true);
    reset role;
    return 'APPLIED';
  exception when others then
    perform set_config('request.jwt.claims', null, true);
    reset role;
    return sqlstate;
  end;
end $$;

/* PINNED BY IDENTITY, NOT BY `order by id limit 1`.
   Every id here is a gen_random_uuid(), so "the first row" is a DIFFERENT row
   on every reset. Three rows carry no rake model and one of them — Golden
   Nugget's $4/8 limit — is FLOOR-ranked, so roughly one run in three this test
   drew that row and got a precedence refusal (CID03) instead of the constraint
   violation (23514) it exists to assert. It failed intermittently, on a
   correct database, for a reason that had nothing to do with what it tests.
   A flaky gate is worse than a missing one: it teaches you to re-run. */
create temp table pgtap_group as
  select (select c.id from public.cash_games c
            join public.rooms r on r.id = c.room_id
           where c.rake_type is null and r.slug = 'golden-nugget' and c.stakes_label = '$4/8 limit') as bare_row;

select isnt((select bare_row from pgtap_group), null,
  'the grouped-rake fixture row exists — a NULL here would make every assertion below vacuous');

select is(
  pg_temp.try_group((select bare_row from pgtap_group), true),
  'APPLIED',
  'a room GAINS A RAKE through a group — model before figures, one transaction'
);

select is(
  (select rake_type from public.cash_games where id = (select bare_row from pgtap_group)),
  'pot',
  '...and the model landed'
);

select is(
  /* NUMERIC, not text: rake_cap is numeric(6,2) and renders '6.00'. The same
     spelling-versus-value trap the prose probe hit. */
  (select rake_cap from public.cash_games where id = (select bare_row from pgtap_group)),
  6::numeric,
  '...and so did the cap that could not be written on its own'
);

-- ALL OR NOTHING. A group carrying one impossible member must leave the row
-- untouched — a half-applied rake model is the failure this exists to prevent.
create or replace function pg_temp.try_bad_group(p_target uuid)
returns text language plpgsql as $$
declare
  v_room uuid; v_src uuid; v_ids uuid[];
begin
  select room_id into v_room from public.cash_games where id = p_target;
  /* FLOOR-sourced: the only model-less row left ranks floor, so a web proposal
     would be refused by precedence before the constraint under test is ever
     reached. The group tests are about ORDERING, not about precedence. */
  select id into v_src from public.sources where data_type = 'floor' limit 1;
  insert into public.pending_changes
    (target_table, target_id, room_id, operation, field, new_value, agent, source_id, source_url)
  select 'cash_games', p_target, v_room, 'update', f.field, f.val, 'pgtap-badgroup',
         v_src, (select url from public.sources where id = v_src)
    from (values ('rake_type', '"time"'::jsonb), ('rake_cap', '99'::jsonb)) as f(field, val);
  select array_agg(id) into v_ids from public.pending_changes where agent = 'pgtap-badgroup';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"email":"admin@example.test"}', true);
    perform public.approve_change_group(v_ids, true);
    perform set_config('request.jwt.claims', null, true);
    reset role;
    return 'APPLIED';
  exception when others then
    perform set_config('request.jwt.claims', null, true);
    reset role;
    return sqlstate;
  end;
end $$;

select is(
  pg_temp.try_bad_group((select bare_row from pgtap_group)),
  '23514',
  'a group whose members contradict the rake model is refused — time-charge cannot carry a cap'
);

select is(
  (select rake_type from public.cash_games where id = (select bare_row from pgtap_group)),
  'pot',
  '...and the row is UNCHANGED by the failed group — all or nothing, not half a model'
);

select is(
  (select rake_cap from public.cash_games where id = (select bare_row from pgtap_group)),
  6::numeric,
  '...including the figure the failed group would have overwritten'
);

-- ─── WHO MAY APPLY, NOW THAT NOBODY APPROVES ─────────────────────────
-- The scheduled differ holds the database credential and carries no JWT, so
-- is_admin() is false for it. is_service_caller() is the narrow allowance that
-- lets the pipeline write at all — and it must NOT be satisfiable by anything
-- arriving over HTTP.
select ok(
  public.is_service_caller(),
  'is_service_caller() is TRUE for a process holding the database credential — the differ can write'
);

select ok(
  not pg_temp.runs_as('anon', '{}'::jsonb,
    $$ select case when public.is_service_caller() then 1 else 1/0 end $$)
  or not pg_temp.runs_as('authenticated', '{"email":"stranger@example.test"}'::jsonb,
    $$ select case when public.is_service_caller() then 1 else 1/0 end $$),
  'and it is NOT satisfied by anon or by an ordinary signed-in user'
);

-- ─── jackpot_drop IS A RAKE FIELD (migration 010) ────────────────────
-- Three tests asked "is this a rake field?" with `field like 'rake%'`, which
-- every rake column matches except jackpot_drop. It was unreachable until
-- something wrote a drop ON ITS OWN — every earlier apply moved it beside
-- rake_cap, whose name matched, so the drop rode along on the right branch.
-- The first real differ run did write one alone, and it moved the row's STAKES
-- citation to a sheet that does not state stakes. Pinned here so it cannot come
-- back the same way.
select ok(public.is_rake_field('jackpot_drop'),
  'jackpot_drop is a rake field — the member whose name breaks the rake_ pattern');
select ok(public.is_rake_field('rake_cap'), 'and so are the ones that do match it');
select ok(not public.is_rake_field('stakes_label'),
  'and a stakes column is not — the predicate is a list, not a guess');

-- THE CONSEQUENCE, ASSERTED AT THE LEVEL IT ACTUALLY BIT: a drop change must
-- rank against the RAKE's citation, not the row's.
select is(
  public.fact_source_kind('cash_games', (select floor_row from pgtap_prec), 'jackpot_drop'),
  public.fact_source_kind('cash_games', (select floor_row from pgtap_prec), 'rake_cap'),
  'a jackpot_drop write ranks against the same fact as a rake_cap write'
);

-- AND THE RECEIPT GOES TO THE RAKE COLUMN. This is the assertion that would
-- have caught the production misattribution before it happened.
do $$
declare v_id uuid; v_target uuid; v_room uuid; v_src uuid;
begin
  select c.id, c.room_id into v_target, v_room from public.cash_games c
   where public.fact_source_kind('cash_games', c.id, 'rake_cap') = 'web'
     and c.rake_type is not null order by c.id limit 1;
  select id into v_src from public.sources where data_type = 'cash' limit 1;
  insert into public.pending_changes
    (target_table, target_id, room_id, operation, field, new_value, agent, source_id, source_url)
  values ('cash_games', v_target, v_room, 'update', 'jackpot_drop', '3'::jsonb,
          'pgtap-drop-receipt', v_src, 'https://vegasadvantage.com/pgtap-drop')
  returning id into v_id;
  perform pg_temp.runs_as('authenticated', '{"email":"admin@example.test"}'::jsonb,
    format('select public.approve_change(%L::uuid)', v_id));
end $$;

select is(
  (select c.rake_source_url from public.cash_games c
    join public.pending_changes p on p.target_id = c.id
   where p.agent = 'pgtap-drop-receipt'),
  'https://vegasadvantage.com/pgtap-drop',
  'a jackpot_drop change moves the RAKE receipt — not the row''s stakes citation'
);

select isnt(
  (select c.source_url from public.cash_games c
    join public.pending_changes p on p.target_id = c.id
   where p.agent = 'pgtap-drop-receipt'),
  'https://vegasadvantage.com/pgtap-drop',
  '...and leaves the stakes citation alone — the exact misattribution that reached production'
);

-- ─── TOURNAMENTS: the first real rows these tables have held ─────────
-- Five tables sat at zero rows since they were created, so every constraint on
-- them was a hypothesis. The Wynn pilot exercises them; these assert the ones
-- that would let bad data in.
select ok(
  pg_temp.works_as('anon', $$ select 1 from public.tournament_templates limit 1 $$),
  'anon may read tournaments — a schedule is for readers'
);
select ok(
  not pg_temp.works_as('anon',
    $$ insert into public.tournament_templates (room_id, slug, name, start_time, entry_amount, fee_amount)
       values ((select id from public.rooms limit 1), 'x', 'x', '12:00', 1, 1) $$),
  'anon may NOT write one'
);

-- THE GENERATED COLUMNS ARE THE HONEST BUY-IN, so they are asserted against the
-- document's own arithmetic rather than trusted.
select is(
  (select total_buy_in from public.tournament_templates where slug = 'wynn-daily-200-nlh-10k'),
  200.00::numeric,
  'the split reproduces the poster: 162 prize + 26 house + 12 staff = the $200 advertised'
);
select is(
  (select fee_percent from public.tournament_templates where slug = 'wynn-daily-200-nlh-10k'),
  13.00::numeric,
  'and fee%% is the HOUSE cut over the total — 26/200 — not the staff charge as well'
);

-- 0=Sun..6=Sat. An out-of-range day never matches a query and an empty array
-- claims a weekly that runs on no day at all.
select throws_ok(
  $$ insert into public.tournament_templates (room_id, slug, name, start_time, entry_amount, fee_amount, days_of_week)
     values ((select id from public.rooms limit 1), 'bad-day', 'x', '12:00', 1, 1, array[7]::smallint[]) $$,
  '23514', null, 'a day outside 0-6 is refused rather than silently never matching');
select throws_ok(
  $$ insert into public.tournament_templates (room_id, slug, name, start_time, entry_amount, fee_amount, days_of_week)
     values ((select id from public.rooms limit 1), 'no-day', 'x', '12:00', 1, 1, array[]::smallint[]) $$,
  '23514', null, 'and an empty day array cannot claim a weekly that never runs');

-- ⚠️ A DOCUMENT DATE MUST BE EXPLAINED (migration 011). A date with no
-- provenance is the same failure as a figure with no source: a PDF's
-- CreationDate is evidence, a printed date is a statement, and storing them
-- indistinguishably would let an inference read as a claim.
select throws_ok(
  $$ insert into public.tournament_templates (room_id, slug, name, start_time, entry_amount, fee_amount, document_effective_on)
     values ((select id from public.rooms limit 1), 'undated', 'x', '12:00', 1, 1, '2026-01-01') $$,
  '23514', null, 'a document date with no stated origin is refused');
select lives_ok(
  $$ insert into public.tournament_templates (room_id, slug, name, start_time, entry_amount, fee_amount,
       document_effective_on, document_date_source)
     values ((select id from public.rooms limit 1), 'dated-ok', 'x', '12:00', 1, 1, '2026-01-01', 'printed') $$,
  'and one that says where it came from is accepted');

-- PRECEDENCE: a room's own PDF is WEB, not floor. Nobody stood in the room, and
-- ranking it as floor would block the correction a floor visit is for.
select is(
  public.source_kind_of(
    (select structure_pdf_url from public.tournament_templates where slug = 'wynn-daily-200-nlh-10k'), null),
  'web',
  'a room-published schedule PDF ranks WEB, so a later floor visit corrects it without an override'
);

-- ─── THE SERIES: MIGRATION 012 AND TRANSCRIPTION FIDELITY ────────────
-- A wrong blind level is SILENT — nothing about it looks broken — so the shape
-- of 659 transcribed rows is asserted rather than eyeballed.
select is(
  (select count(*)::int from tournament_levels), 659,
  'all 659 levels transcribed — 22 structure sheets, none skipped'
);
select is(
  (select count(*)::int from tournament_instances), 61,
  'all 61 scheduled events present — the schedule''s own count'
);

-- THE PK CHANGE IS THE POINT OF 012: a mixed game genuinely has two rows for
-- one level, and the old key made the second unwritable.
select is(
  (select count(*)::int from tournament_levels l
    join tournament_templates t on t.id = l.template_id
   /* ONE template, not every HORSE — `like '%horse%'` matched the $400 and the
      $600 and reported 4, which is the assertion being loose rather than the
      data being wrong. */
   where t.slug = 'wynn-series-horse-400-p14' and l.level_number = 1), 2,
  'a HORSE level 1 holds BOTH its limit and stud rows — impossible under the old primary key'
);
select throws_ok(
  $$ insert into tournament_levels (template_id, level_number, game_type, small_blind, big_blind, ante, minutes)
     /* A ROW THAT DEMONSTRABLY EXISTS. `limit 1` drew an arbitrary template,
        and a HORSE template has no 'main' levels at all — so the insert
        succeeded and the assertion failed against a working key. */
     select id, 1, 'main', 1, 2, 0, 30 from tournament_templates
      where slug = 'wynn-series-no-limit-hold-em-400-p4' $$,
  '23505', null, 'and the key still refuses a duplicate (template, level, game)');

-- A limit level that drops its bets describes a different game.
select throws_ok(
  $$ insert into tournament_levels (template_id, level_number, game_type, small_blind, big_blind, ante, minutes)
     select id, 99, 'limit', 100, 200, 0, 30 from tournament_templates limit 1 $$,
  '23514', null, 'a limit level with no bet sizes is refused — the bets ARE the structure');
select ok(
  (select bool_and(small_bet is not null and big_bet is not null)
     from tournament_levels where game_type in ('limit', 'stud')),
  'and every transcribed limit/stud level carries both bets'
);
select is(
  (select count(*)::int from tournament_levels where game_type = 'main' and small_bet is not null), 0,
  'while a no-limit level claims no fixed bet it does not have'
);

-- ⚠️ THE LIVE FALSEHOOD 012 PREVENTS. Six Day 2 rows take no buy-in; without
-- entry_kind they are indistinguishable from the flights that started the event
-- and a reader turns up with cash on the wrong day.
select is(
  (select count(*)::int from tournament_instances where entry_kind = 'continuation'), 6,
  'the six Day 2 rows are marked as continuations'
);
select is(
  (select count(*)::int from tournament_instances where entry_kind = 'continuation' and takes_entry), 0,
  'and not one of them advertises an entry'
);
select is(
  (select count(*)::int from tournament_instances where entry_kind = 'flight'), 18,
  'the eighteen starting flights DO take entries'
);

-- Contiguous from 1 within each (event, game_type), and never going backwards.
select is(
  (select count(*)::int from (
     select template_id, game_type, count(*) c, min(level_number) lo, max(level_number) hi
       from tournament_levels group by 1,2) z
    where z.lo <> 1 or z.hi <> z.c), 0,
  'every event''s levels run 1..n with no gaps, per game_type'
);
select is(
  (select count(*)::int from (
     select l.*, lag(small_blind) over w psb, lag(big_blind) over w pbb, lag(ante) over w pa
       from tournament_levels l
       window w as (partition by template_id, game_type order by level_number)) z
    where z.small_blind < z.psb or z.big_blind < z.pbb or z.ante < z.pa), 0,
  'and blinds and antes never go backwards inside their own game_type'
);

select * from finish();
rollback;
