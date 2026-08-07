-- =====================================================================
-- HARDEN GRANTS — hosted Supabase's defaults are the LOCAL finding
-- inverted. Local granted anon almost nothing (policies were inert until
-- explicit grants landed — see the initial schema's grants block). Hosted
-- grants anon and authenticated FULL DML — DELETE, INSERT, SELECT,
-- TRUNCATE, UPDATE — on every table created by migration, leaving RLS as
-- the only layer denying the maintenance tables. Behaviorally safe;
-- structurally single-layer, which is exactly what the grant doctrine
-- forbids: withholding the privilege enforces the denial a second way,
-- so a future permissive policy cannot silently open a table.
--
-- Found 2026-08-05 on the first hosted deploy: anon probing /sources
-- returned 200-empty (RLS filtering) instead of local's 42501 (privilege
-- denied). information_schema showed anon holding all seven privileges
-- on every table. This migration re-asserts the designed set wholesale,
-- then closes the default so future tables start with NOTHING for the
-- public roles — a forgotten grant fails loudly in a test; a default
-- grant fails silently in production. On the local stack these revokes
-- are near-no-ops, which is the point: one migration, both environments,
-- one behavior.
-- =====================================================================

revoke all on all tables in schema public from anon, authenticated;

grant select on
  markets, rooms, cash_games, amenity_types, room_amenities, house_rules,
  tournament_series, tournament_templates, tournament_levels,
  tournament_instances, promotions, room_freshness
to anon, authenticated;

-- corrections: a write-only mailbox at BOTH layers — insert, never read.
grant insert on corrections to anon, authenticated;

-- Future tables created by the migration role start closed for the
-- public roles. This is the auto-REVOKE direction: the doctrine's
-- objection was to auto-GRANTING (a private table becoming readable
-- silently); starting closed makes the failure loud instead.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
