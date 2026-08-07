-- =====================================================================
-- VENDOR AND FORMATS — two tables for facts we already hold and cannot
-- yet render.
--
-- Both exist because the alternative is worse. The waitlist vendor per
-- room and the two `dbbp` observations are partner-verified data sitting
-- in a document; leaving them there means the next person re-derives
-- them, and the derivation is exactly where "Venetian" became the
-- Sphere. Storing them costs a migration. Losing them costs a re-survey.
--
-- NEITHER TABLE RENDERS ANYTHING TODAY, and that is the designed state
-- rather than an unfinished one. See the notes on `enabled` and on
-- `slug` below — each column that looks inert is inert on purpose, with
-- the decision recorded at the column.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The vendor IS an enum, and `room_formats.slug` deliberately is not.
-- The difference is whether we know the vocabulary.
--
-- There are exactly two waitlist vendors in this market, both are named
-- on the partner sheet, and both have been measured (PokerAtlas 403,
-- Bravo 403 + Cloudflare 404s — see the README constraint table). The
-- set is closed and confirmed, so the database should reject a third.
-- ---------------------------------------------------------------------
create type waitlist_vendor as enum ('pokeratlas', 'bravo');

-- ---------------------------------------------------------------------
-- WHICH VENDOR RUNS THE LIST — one per room, hence room_id as the PK.
--
-- A room runs one waitlist system; modelling it as one row per room
-- makes a second vendor a constraint violation rather than a silent
-- duplicate that two surfaces would disagree about.
-- ---------------------------------------------------------------------
create table room_waitlist (
  room_id     uuid primary key references rooms(id) on delete cascade,
  vendor      waitlist_vendor not null,
  url         text,                    -- the room's page at that vendor, when known
  /* THE BUTTON STAYS HIDDEN EVERYWHERE — standing ruling, and `enabled`
     is how it stays hidden without the knowledge being thrown away.
     This is DATA FOR LATER, for per-room activation once there is a
     reason to trust a given room's list; it is not a feature flag and
     nothing reads it yet. Defaulting false means turning one on is a
     deliberate per-room act, and the fifteen rows below all land off. */
  enabled     boolean not null default false,
  source_url  text,
  fetched_at  timestamptz,
  verified_at timestamptz
);

-- ---------------------------------------------------------------------
-- FORMATS A ROOM RUNS — and `slug` is TEXT, not an enum, ON PURPOSE.
--
-- The two rows this ships with are `dbbp`, an abbreviation recorded off
-- the partner sheet whose expansion is UNCONFIRMED. Our own README
-- forbids naming schema vocabulary after an unconfirmed term, and an
-- enum is the most permanent kind of naming there is: it would put a
-- guess in `pg_type`, in the generated TypeScript, and in every dump.
--
-- Text costs a constraint we do not get. It buys the ability to be
-- wrong cheaply — `update ... set slug = ...` instead of a migration to
-- rename an enum label. When the expansion is confirmed on the floor,
-- tightening this to an enum is a small deliberate change; guessing now
-- and being wrong is not.
--
-- `label` is the render gate, and NULL is its meaningful value: a row
-- with no label is a fact we hold and will not put on a page, because
-- we cannot write the words. See the FORMATS block in the room page.
-- ---------------------------------------------------------------------
create table room_formats (
  room_id     uuid not null references rooms(id) on delete cascade,
  slug        text not null,
  label       text,                    -- NULL = recorded, not renderable. Deliberate.
  note        text,
  source_url  text,
  fetched_at  timestamptz,
  verified_at timestamptz,
  primary key (room_id, slug)
);

/* No separate room_id index on either table: room_waitlist is keyed on
   room_id, and room_formats' composite PK leads with it, so both
   room-scoped lookups already have one. Noted so the absence reads as a
   decision rather than an omission. */

-- ---------------------------------------------------------------------
-- RLS + GRANTS, per doctrine: policies are inert without grants, so both
-- layers are stated for both tables.
-- ---------------------------------------------------------------------
alter table room_waitlist enable row level security;
alter table room_formats  enable row level security;

create policy public_read_waitlist on room_waitlist for select using (true);
create policy public_read_formats  on room_formats  for select using (true);

-- Read for the public roles. SELECT only — no anon INSERT/UPDATE/DELETE
-- is granted anywhere below, which is the second layer under "no policy
-- permits a write".
grant select on room_waitlist, room_formats to anon, authenticated;

/* SERVICE_ROLE MUST BE GRANTED EXPLICITLY, and this is the trap worth
   naming. The initial schema's `grant ... on all tables ... to
   service_role` was a ONE-TIME grant over the tables existing that day —
   it does not reach forward. Migration 2's ALTER DEFAULT PRIVILEGES only
   REVOKES, and only for anon and authenticated, so it does not fill the
   gap either.
   Verified 2026-08-07 against `admins` (created in migration 4): its
   service_role grants are REFERENCES, TRIGGER, TRUNCATE — no SELECT, no
   DML. That table is only ever read through a SECURITY DEFINER function,
   so nothing has broken, but the next writer-facing table created
   without this line would be unwritable by the one role meant to write
   it. `rolbypassrls` does not help: bypassing RLS is not holding a
   table privilege. */
grant select, insert, update, delete on room_waitlist, room_formats to service_role;

comment on table room_waitlist is
  'Which waitlist vendor runs a room''s list. Both vendors are measured unfetchable; '
  'this records the fact, and `enabled` gates a per-room button that ships hidden.';
comment on table room_formats is
  'Formats a room runs. `slug` is text because ''dbbp'' is an unexpanded abbreviation; '
  'a row with a NULL label is recorded but deliberately not rendered.';
