-- =====================================================================
-- USAGE EVENTS. 2026-08-11. PROPOSED — not applied to production.
-- =====================================================================
-- ⚠️ THIS DATA SITS OUTSIDE THE PRECEDENCE LAW, AND THAT IS THE WHOLE POINT.
--
-- Every other table in this database holds FACTS ABOUT ROOMS. A fact carries a
-- `source_url`, a `fetched_at` and a `verified_at`; it is ranked by where it
-- came from; a floor visit overrides a web read; and nothing is shown without a
-- receipt. Migration 008 encodes all of that.
--
-- NONE OF IT APPLIES HERE. A row in this table says "a browser did a thing".
-- It has no source, because we are the source. It has no verified_at, because
-- there is nobody to verify it with — a click cannot be confirmed on site. It
-- cannot be corrected, contradicted or overridden by a better tier. It is not
-- evidence about a poker room and must never be rendered as though it were:
-- "most viewed" is not "best", and a room with more outbound clicks is not a
-- room with a lower rake.
--
-- So it lives in its OWN SCHEMA. Not a `public.analytics_events` table that
-- sits in the same namespace as `cash_games` and gets joined into a ranking by
-- somebody who assumes everything in `public` is a fact. The schema boundary is
-- the comment that cannot be skimmed past.
--
-- =====================================================================
-- WHAT IS DELIBERATELY NOT COLLECTED
-- =====================================================================
-- NO IP ADDRESS. Not hashed, not truncated, not "just for rate limiting". An
-- IP is personal data in every jurisdiction that has an opinion, it is the
-- field that turns an event log into a tracking log, and rate limiting is done
-- per session in the handler where the session is a token we minted ourselves.
--
-- NO RAW USER-AGENT. A UA string is a fingerprinting input and a free-text
-- column nobody ever reads. What the product actually needs is one bit — was
-- this a bot — so the classification happens at write time and only the ANSWER
-- is stored, with the version of the classifier that decided it. Without that
-- version a re-classification later cannot tell which rows were judged by which
-- rules, and "we filtered bots" becomes an unfalsifiable claim.
--
-- NO REFERRER, no screen size, no language, no timezone, no canvas, no fonts.
-- `device_id` is a random token in localStorage and `session_id` is a random
-- token in sessionStorage. Neither is derived from anything about the device,
-- so neither survives a cleared browser and neither identifies a person across
-- one.
-- =====================================================================

create schema analytics;

comment on schema analytics is
  'Usage events. OUTSIDE the precedence law: no source_url, no verified_at, no '
  'receipts, no ranking. A row here is a fact about a browser, never a fact '
  'about a room, and must never be joined into anything a reader sees as one.';

-- ---------------------------------------------------------------------
-- THE EVENT NAMES, AS AN ENUM
-- ---------------------------------------------------------------------
-- An enum rather than free text so a new event name costs a migration and a
-- review — the same friction `tournament_offer_window` carries, for the same
-- reason. A text column would let a typo become a permanent second event that
-- nobody notices until a count is half what it should be.
--
-- ⚠️ SEVEN NAMES. `share_link_copy` was specified conditionally —
-- "only if there is a share affordance" — and there is not one: no clipboard
-- call, no `navigator.share`, no copy-link control anywhere in `app/`. An event
-- with no producer is a column that is always zero, which reads as "nobody
-- shares this" rather than "we never asked".
--
-- Three names from the prototype are deliberately absent for the same reason:
-- promo_detail_view (no promo detail screen exists), verify_complete (no
-- verification flow in the product), digest_subscribe (no digest).
create type analytics.event_name as enum (
  'room_facts_view',
  'map_filter_apply',
  'tournament_row_open',
  'outbound_room_click',
  -- SEPARATE FROM outbound_room_click SINCE 2026-08-11. One is demand — a
  -- reader leaving for the room. The other is somebody checking our work.
  -- Merging them inflates the only number a room would be right to challenge,
  -- and the two move in opposite directions: receipts get clicked more when a
  -- figure looks WRONG.
  'source_link_click',
  'fact_report_submit',
  'install_accept'
);

create table analytics.events (
  id            uuid primary key default gen_random_uuid(),
  event_name    analytics.event_name not null,

  -- ⚠️ A BATCH SHARES ONE TIMESTAMP. INTRA-SESSION ORDER IS NOT RECOVERABLE.
  -- RECORDED 2026-08-11 — a limitation, not a bug, and not being fixed today.
  --
  -- `now()` in Postgres is the START OF THE TRANSACTION, not the moment the row
  -- is written. `record_events` inserts a whole batch in one statement, and the
  -- client batches on a microtask — so a reader who applies a filter and then
  -- immediately clicks a room produces TWO ROWS WITH IDENTICAL `occurred_at`,
  -- to the microsecond. `id` is a random uuid and orders nothing.
  --
  -- WHAT THIS COSTS, PRECISELY:
  --   · Fine — "how many room views last week", "which rooms get clicked
  --     through to", every count and every daily/weekly roll-up. Order within a
  --     millisecond is irrelevant to all of them, and those are the questions
  --     this table was built for.
  --   · FATAL — any funnel. "Did they filter before or after opening the room",
  --     "what did they look at last before leaving", time-on-step, drop-off
  --     between two events in one batch. Those questions cannot be answered
  --     from this data AT ALL, and — worse — a `order by occurred_at` query
  --     will happily return SOME order, silently chosen by the planner. The
  --     answer would look real.
  --
  -- THE FIX, NOT IMPLEMENTED: a client-side monotonic sequence number — one
  -- integer per session, incremented on every `track()` call, sent with the
  -- event and stored in a `seq` column. Ordering then comes from the client
  -- that observed the order rather than from the server that received a bundle.
  -- Cost: one column, one migration, ~5 lines in `lib/analytics.ts`, and the
  -- client-trust question that comes with it (a `seq` is client-supplied, so it
  -- orders a session and must never be treated as a clock). Not worth doing
  -- speculatively — it should be built the day a funnel is actually asked for,
  -- and NOT retrofitted onto the rows already collected, which cannot be
  -- ordered after the fact.
  occurred_at   timestamptz not null default now(),

  -- Random tokens we mint. NOT derived from anything about the device.
  device_id     text not null,
  session_id    text not null,

  -- ON DELETE SET NULL, not CASCADE. The event happened; a room row going away
  -- does not un-happen it, and deleting history to keep a foreign key tidy is
  -- falsifying a log. Nullable because most events are not about a room at all.
  room_id       uuid references public.rooms(id) on delete set null,

  props         jsonb not null default '{}'::jsonb,

  -- Our own traffic, flagged at write time so it can be excluded from any count
  -- without being deleted. A deleted row cannot be re-included when the
  -- definition of "internal" turns out to be wrong.
  is_internal   boolean not null default false,

  -- ONE BIT INSTEAD OF A USER-AGENT, plus the rules that decided it.
  bot           boolean not null default false,
  bot_rules_version text not null,

  created_at    timestamptz not null default now()
);

comment on column analytics.events.bot is
  'Decided at write time from the request user-agent, which is NOT stored. '
  'Read with bot_rules_version or the filter is unfalsifiable.';
comment on column analytics.events.bot_rules_version is
  'Which classifier judged this row. Without it a later re-classification '
  'cannot tell which rows were judged by which rules.';
comment on column analytics.events.props is
  'Event-specific detail. Never personal, never a fact about a room — a value '
  'here is not evidence and carries no source.';

-- ---------------------------------------------------------------------
-- CONSTRAINTS — the endpoint is public-facing, so the table defends itself
-- ---------------------------------------------------------------------
-- The write path is a route handler we control, but a table whose only
-- protection is the code in front of it is a table protected by nothing the day
-- somebody adds a second caller.
alter table analytics.events add constraint device_id_is_a_token check (
  length(device_id) between 8 and 64
);
alter table analytics.events add constraint session_id_is_a_token check (
  length(session_id) between 8 and 64
);
-- A jsonb bomb is the cheapest way to turn an events endpoint into a storage
-- bill. 2KB is far more than any of the six events needs.
alter table analytics.events add constraint props_is_small check (
  pg_column_size(props) <= 2048
);
-- ⚠️ DORMANT BY CONSTRUCTION — KEPT, BUT NOT AN ACTIVE GATE. RECORDED 2026-08-11.
--
-- This CHECK cannot fire today, and the reason is structural rather than
-- circumstantial: `occurred_at` is ABSENT FROM THE INSERT COLUMN LIST in
-- `public.record_events` below. The function is the only door into this table
-- (no role holds INSERT on it), so no caller — honest, broken or hostile — has
-- any way to supply the column. It always takes its `default now()`, and a
-- server clock is never an hour ahead of itself.
--
-- It is kept anyway, because it costs nothing and it is the guard that starts
-- mattering the moment somebody adds `occurred_at` to that insert list to
-- support offline queueing — which is the plausible next change, and exactly
-- the change that would let a wrong client clock write the future.
--
-- What it must NOT be is counted as a working defence. "The table validates
-- timestamps" is true of the schema and false of the system as it runs, and a
-- dormant constraint read as a live one is how a gate gets credited for work it
-- is not doing.
alter table analytics.events add constraint occurred_at_is_not_ahead check (
  occurred_at <= now() + interval '1 hour'
);

-- ---------------------------------------------------------------------
-- ⚠️ DEVICES — THE ONE TABLE RETENTION MUST NEVER TOUCH
-- ---------------------------------------------------------------------
-- One row per device_id, written the first time it is ever seen. It holds a
-- token and a date and nothing else — no events, no rooms, no counts.
--
-- ═══ WHY IT EXISTS, AND WHY IT EXISTS *NOW* ═══
--
-- The north-star measure is NEW REACH: devices with no prior event EVER. That
-- word "ever" is the entire definition, and it needs unbounded history.
--
-- Under the 90-day raw window proposed at the foot of this file, "no prior
-- event ever" silently degrades into "no prior event IN 90 DAYS". A reader who
-- first visited in March and comes back in August is counted as NEW — and
-- nothing anywhere errors. No constraint fires, no query fails, no log line
-- appears. The number simply inflates, permanently, in the direction that
-- flatters us. It is the worst shape a metric bug can take: silent, one-way,
-- and on the figure decisions get made from.
--
-- ⚠️ AND IT CANNOT BE ADDED LATER. A devices table built after the fact can
-- only be backfilled from the events that still exist, so every device whose
-- first visit has already aged out gets a first_seen_at that is not its first
-- visit — and, being a plausible date, is indistinguishable from a real one
-- forever after. There is no repair. That is why this table ships in the same
-- migration as `events` rather than with the retention job that makes it
-- necessary: it must exist BEFORE the first row, not before the first deletion.
create table analytics.devices (
  device_id     text primary key,
  first_seen_at timestamptz not null default now(),

  constraint device_id_is_a_token check (length(device_id) between 8 and 64)
);

comment on table analytics.devices is
  'One row per device, written on first sight. EXCLUDED FROM ALL RETENTION — '
  'see the retention note at the foot of migration 017. "New reach" means '
  'devices with no prior event EVER; under a 90-day raw window that term '
  'degrades to "none in 90 days" with no error anywhere, and a devices table '
  'backfilled after the fact cannot tell a real first visit from an aged-out '
  'one. It holds a random token and a date — no events, no rooms, no counts.';
comment on column analytics.devices.first_seen_at is
  'The first time this token was seen. NEVER updated — an upsert that touched '
  'this column would turn the one fact the table exists to hold into a '
  'last-seen date, and nothing downstream would notice.';

create index devices_first_seen_idx on analytics.devices (first_seen_at);

create index events_name_time_idx on analytics.events (event_name, occurred_at desc);
create index events_time_idx      on analytics.events (occurred_at desc);
create index events_room_idx      on analytics.events (room_id) where room_id is not null;

-- ---------------------------------------------------------------------
-- ⚠️ NO ANON GRANTS. NOT SELECT, NOT INSERT.
-- ---------------------------------------------------------------------
-- Two independent locks, because this repo has already been bitten once by
-- assuming one was enough: RLS policies were inert without GRANTs, the schema
-- looked flawless, and every structural check passed.
--
--   1. NOT EXPOSED TO PostgREST. Supabase serves only the schemas named in its
--      API settings — `public` and `graphql_public` by default. A table in
--      `analytics` has no REST route at all, so there is nothing for a browser
--      to call even with a key. This is the lock that matters, and it is the
--      reason for a separate schema rather than a `public.` table.
--   2. NO GRANTS ANYWAY. Even if somebody adds `analytics` to the exposed
--      schemas, anon and authenticated hold nothing on it.
--
-- RLS is enabled with NO POLICIES as the third lock: `service_role` bypasses
-- RLS, so the table stays writable by the handler while being closed to every
-- other role even if a grant is added by mistake later.
revoke all on schema analytics from public;
revoke all on all tables in schema analytics from public;

-- ⚠️ NOTHING IS GRANTED TO service_role ON THIS TABLE.
-- An earlier draft gave it SELECT and INSERT, on the assumption the app would
-- write over REST as the service role. It does not — see the dedicated writer
-- below — and PostgREST would refuse the schema anyway. A grant nothing uses is
-- a privilege waiting to be used by something else.
--
-- Reads for a human are `psql` as postgres, which is how every other
-- maintenance task in this repo already works.

alter table analytics.events enable row level security;
alter table analytics.devices enable row level security;

-- Nothing granted to anon or authenticated, and no policy for either. Stated as
-- a positive line rather than left as an absence, because "we did not grant it"
-- and "we forgot to think about it" look identical in a schema dump.
--
-- BOTH TABLES NAMED. `devices` holds the longest-lived data in this schema —
-- it is the one thing retention never deletes — so it is the last table that
-- should inherit its permissions from a line somebody wrote about a different
-- table.
revoke all on analytics.events from anon, authenticated;
revoke all on analytics.devices from anon, authenticated;

-- ⚠️ AND THE SAME FOR TABLE TWO, WHICH NOBODY HAS WRITTEN YET.
-- Every REVOKE above names `analytics.events`. They are statements about one
-- table that exists today, and they say nothing at all about the next one.
--
-- Migration 002 installed the repo's auto-REVOKE so a new table could not
-- arrive readable by accident — but it is SCOPED TO SCHEMA public, because that
-- was the only schema when it was written. `analytics` is outside it. So a
-- second table added here would be governed by whatever default privileges the
-- cluster hands out, and on hosted Supabase those are not empty: the platform
-- ships default privileges that grant to anon and authenticated precisely so
-- that a table created in the dashboard is immediately usable over REST. That
-- convenience is the wrong default for this schema.
--
-- This closes the door before the room is built. `alter default privileges`
-- applies to objects created by the role running it (postgres, whoever applies
-- this file), which is the same role that would add table two.
--
-- It is belt-and-braces on top of the not-exposed-to-PostgREST lock, and that
-- is deliberate: the person who adds table two will be thinking about their
-- table, not about this comment.
alter default privileges in schema analytics
  revoke all on tables from anon, authenticated;

-- ---------------------------------------------------------------------
-- THE WRITE PATH: AN RPC IN `public`, EXECUTABLE ONLY BY cid_events_writer
-- ---------------------------------------------------------------------
-- ⚠️ FOUND WHILE BUILDING THE HANDLER, AND IT CHANGES THE DESIGN.
--
-- PostgREST serves only the schemas named in the API's own configuration —
-- `public, graphql_public`. That is SERVER CONFIG, NOT A PERMISSION, so it
-- applies to the service role exactly as it applies to anon: supabase-js
-- writing to `analytics.events` gets "Invalid schema: analytics" no matter what
-- key it holds. The first version of the handler failed on precisely that.
--
-- The obvious fix — add `analytics` to the exposed schemas — is the wrong one.
-- It would hand PostgREST a route into the table and leave the anon lock
-- resting entirely on grants and RLS. This repo has already been bitten by
-- assuming one lock was enough (policies inert without GRANTs, schema looking
-- flawless), and the not-exposed property is the strongest of the three.
--
-- So the schema stays unexposed and the door is a function in `public`:
--
--   · SECURITY DEFINER, so it may write to a schema the caller cannot reach.
--   · EXECUTE granted to cid_events_writer ONLY. anon, authenticated AND
--     service_role are revoked explicitly, so a browser holding the anon key
--     gets 404 from PostgREST — proven over HTTP, not inferred from the grant
--     table. (An earlier draft granted this to service_role; see the revoke at
--     the foot of this file for why that door was shut again.)
--   · `search_path = ''` and every name schema-qualified. A SECURITY DEFINER
--     function that resolves an unqualified name is a privilege-escalation
--     primitive: whoever controls the caller's search_path chooses which table
--     runs as the owner.
--
-- The function validates nothing the table does not already validate. Its job
-- is to cross a schema boundary, not to be a second place where the rules live.
create or replace function public.record_events(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  /* ⚠️ DEVICES FIRST, AND `DO NOTHING` RATHER THAN `DO UPDATE`.
     Every device in the batch is recorded before its events are. `do nothing`
     is load-bearing: `do update set first_seen_at = now()` would compile, run,
     and quietly convert the one column this table exists for into a LAST-seen
     date — after which "new reach" counts every returning reader as new, which
     is the exact failure the table was added to prevent.

     It is also why this is not a separate statement in the handler: one door,
     one transaction. A device row written by a call whose events then failed
     would mark a device as "seen" with nothing to show for it, and the next
     visit would not count as new. */
  insert into analytics.devices (device_id)
  select distinct e ->> 'device_id'
  from jsonb_array_elements(payload) as e
  where e ->> 'device_id' is not null
  on conflict (device_id) do nothing;

  insert into analytics.events (
    event_name, device_id, session_id, room_id, props,
    is_internal, bot, bot_rules_version
  )
  select
    (e ->> 'event_name')::analytics.event_name,
    e ->> 'device_id',
    e ->> 'session_id',
    nullif(e ->> 'room_id', '')::uuid,
    coalesce(e -> 'props', '{}'::jsonb),
    coalesce((e ->> 'is_internal')::boolean, false),
    coalesce((e ->> 'bot')::boolean, false),
    e ->> 'bot_rules_version'
  from jsonb_array_elements(payload) as e;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ⚠️ THIS STRING IS DEPLOYED INTO THE PRODUCTION CATALOG, so it is a security
-- claim somebody reads at 2am with `\df+`, not a code comment. It said "EXECUTE
-- is service_role only" — which was true of a draft and false of this file, and
-- it contradicted the header comment forty lines up. A stale comment in a source
-- file is a nuisance; the same words in `pg_description` are an answer to
-- "who can call this?" that no amount of reading the migration will correct.
comment on function public.record_events(jsonb) is
  'The only door into analytics.events. SECURITY DEFINER because the analytics '
  'schema is deliberately not exposed to PostgREST. EXECUTE is granted to '
  'cid_events_writer ONLY — anon, authenticated and service_role are all '
  'revoked, so a browser cannot call it even holding the anon key and there is '
  'no REST path to this table at all.';

-- ⚠️ REVOKE FROM PUBLIC FIRST, AND IT IS NOT DECORATION.
-- Postgres grants EXECUTE ON FUNCTION TO PUBLIC by default at creation time.
-- Every role in the cluster — anon and authenticated included — can call a new
-- function unless that default is taken away. A `grant execute ... to
-- service_role` on its own therefore narrows NOTHING: it adds a privilege that
-- everybody already had.
--
-- The previous version of this file omitted this line. It still answered 401 to
-- anon locally, which proved the state of one database rather than what this
-- file produces — the local role happened to lack USAGE on the schema by an
-- unrelated path. A permission proved by the environment is not a permission
-- the migration grants.
revoke all on function public.record_events(jsonb) from public;
revoke all on function public.record_events(jsonb) from anon, authenticated;

-- ---------------------------------------------------------------------
-- THE DEDICATED WRITER ROLE
-- ---------------------------------------------------------------------
-- The app does NOT hold the service key. `lib/supabase-admin.ts` says there is
-- no service-role client in this codebase and that comment stands unamended:
-- a service key in the app env makes every route a potential full-database
-- write path, and an analytics endpoint is not worth that blast radius.
--
-- So the writer is a role that can do exactly one thing.
--
--   · NO OWNERSHIP of anything.
--   · USAGE on the analytics schema — needed for the function to resolve its
--     target, not to reach the table.
--   · EXECUTE on record_events. That is the entire grant list.
--   · ⚠️ NO INSERT ON analytics.events DIRECTLY. The function stays the single
--     door. A role holding both could write rows that bypass whatever the
--     function later starts validating, and the two paths would drift.
--
-- NO PASSWORD IS SET HERE. A password in a migration is a secret in git. The
-- role is created able to log in and unable to authenticate until somebody runs
--   alter role cid_events_writer with password '…';
-- out of band, which is also the moment it is recorded in the deploy secrets.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cid_events_writer') then
    create role cid_events_writer with login noinherit;
  end if;
end $$;

comment on role cid_events_writer is
  'Writes usage events and nothing else. USAGE on analytics + EXECUTE on '
  'public.record_events. No table privileges, no ownership, no password in git.';

grant usage on schema analytics to cid_events_writer;
grant usage on schema public to cid_events_writer;
grant execute on function public.record_events(jsonb) to cid_events_writer;

-- ⚠️ AND service_role IS TAKEN BACK OFF IT.
-- The REST path is no longer used by anything: the app reaches this function
-- over a pooled Postgres connection as cid_events_writer. Leaving service_role
-- with EXECUTE would keep a second, unused door open — and an unused door is
-- the one nobody notices being walked through.
revoke execute on function public.record_events(jsonb) from service_role;

-- =====================================================================
-- RETENTION: THE RULE IS DECIDED. THE JOB IS DELIBERATELY NOT BUILT.
-- =====================================================================
-- DECIDED 2026-08-11: raw events 90 days, weekly roll-up kept indefinitely,
-- `analytics.devices` NEVER deleted. That is settled; what follows is the
-- reasoning and the two traps.
--
-- ⚠️ AND NO DELETION JOB SHIPS UNTIL THE ROLL-UP IS LIVE *AND* VERIFIED TO HOLD
-- THE WEEKS IT IS ABOUT TO DESTROY. The roll-up does not exist yet. A delete
-- that runs before its consumer exists is not "getting ahead of the work" — it
-- is the irreversible half of the change shipping first, and it would take the
-- only copy of the product's first thirteen weeks with it. Those are the weeks
-- that establish the baseline every later comparison is measured against, and
-- they cannot be re-collected at any price.
--
-- The order is: build the roll-up → run it → CHECK IT HOLDS THOSE WEEKS →
-- only then schedule a delete. Writing the rule down now is what stops it being
-- reinvented differently later; building the job now is what would lose data.
--
-- RECORDED 2026-08-11. Nothing above deletes anything, ever. This table grows
-- without bound and no job trims it. That is the state as applied, and it is
-- written down because an absent retention policy is invisible — it looks
-- exactly like a retention policy nobody has needed yet, right up until the
-- table is three years old and holds the browsing history of every reader the
-- site has ever had.
--
-- THE PROPOSAL, for a decision rather than for merging:
--
--   RAW EVENTS: 90 DAYS. Then deleted.
--
--   Why 90 and not 30 or 400:
--     · It covers a full quarter, so month-over-month and "last 90 days" are
--       answerable from raw rows without touching the roll-up.
--     · IT IS THE RE-CLASSIFICATION WINDOW, and this is the argument that sets
--       it. `bot_rules_version` exists so a later classifier can tell which
--       rows were judged by which rules — but re-judging a row needs the ROW,
--       and the raw rows are the only thing a corrected classifier can be run
--       against. A 30-day window means a bot-rule fix can only repair one
--       month of history. 90 days is long enough for somebody to notice a
--       whole class of traffic was misjudged and still fix the record.
--     · It is well inside the 400-day `device_id` lifetime, so we never hold
--       rows keyed to a token that has already expired out of every browser —
--       data that cannot be joined to anything and cannot be acted on.
--     · Data minimisation cuts the other way from "keep everything in case":
--       the honest question is what we would DO with a 14-month-old raw click,
--       and the answer is nothing that the roll-up does not already answer.
--
--   ⚠️ `analytics.devices` IS EXCLUDED FROM ALL OF IT, FOREVER. Not "kept
--   longer" — never deleted. It is one token and one date per device, it is
--   what makes "no prior event EVER" mean ever, and a deletion job that swept
--   the schema generically would take it out along with the events and inflate
--   new reach with no error anywhere. Any job written against this schema must
--   name its tables explicitly rather than iterating over them.
--
--   WEEKLY ROLL-UP: RETAINED INDEFINITELY. One row per
--   (week, event_name, room_id, bot, is_internal) carrying event count,
--   distinct devices and distinct sessions. Small enough to keep forever —
--   seven names × ~17 rooms × 52 weeks is thousands of rows a year, not
--   millions — and it is what any long-term question actually wants.
--
-- ⚠️ TWO THINGS THE ROLL-UP MUST GET RIGHT, both easy to get wrong once and
-- impossible to correct afterwards:
--
--   1. DISTINCT COUNTS CANNOT BE RECONSTRUCTED LATER. Summing four weekly
--      "distinct devices" figures does not give the monthly distinct devices —
--      it double-counts everyone who came back. Whatever distinct grain is
--      wanted has to be computed WHILE THE RAW ROWS STILL EXIST. Once the 90
--      days are up, the only distinct figure that will ever exist for that week
--      is the one the roll-up wrote down.
--   2. IT MUST KEEP bot AND is_internal AS DIMENSIONS, not filter them out.
--      Rolling up "real traffic only" throws away the denominator and makes
--      "we excluded bots" unfalsifiable — the exact failure the decision to
--      store `bot_rules_version` was taken to avoid. Keep the split; let the
--      reader filter.
--
-- Not implemented because it is a destructive job, and a DELETE on a schedule
-- is not something to add in the same change that creates the table it deletes
-- from. It should land once there is real data to test it against, with the
-- roll-up written and verified FIRST — deleting raw rows before the roll-up is
-- proven correct destroys the only copy.
