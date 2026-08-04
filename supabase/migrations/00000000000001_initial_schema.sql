-- =====================================================================
-- CHECK IT DOWN — v1 schema (Postgres / Supabase)
-- =====================================================================
-- Scope: desktop v1. Rooms, cash games, amenities, house rules,
-- tournaments, promotions — plus the provenance fields and the three
-- maintenance tables the Cowork loop runs on.
--
-- Deliberately NOT here (parked, but the model leaves room):
--   crowd reports, live status, wait times, prediction/observation log,
--   waitlist vendor integration, user accounts.
--
-- Design rules encoded below:
--   * Every published fact carries source + fetched_at + verified_at.
--   * Anything sortable is stored as a NUMBER; labels are derived.
--   * Unverified (verified_at IS NULL) is displayable but never ranked.
--   * Market is data, not an assumption — a second city is a row.
--   * Tournaments are recurring TEMPLATES that generate dated INSTANCES.
--   * Nothing is written straight to a public table by automation;
--     proposals land in pending_changes first.
--   * A ranked number is computed by the database, never "on write" by
--     a caller who might forget. If it sorts, it is generated or checked.
-- =====================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
create type area_kind        as enum ('strip','downtown','off_strip','locals');
create type room_status      as enum ('open','temporarily_closed','closed','seasonal');
create type rake_kind        as enum ('pot','time');          -- pot rake vs time collection
create type game_kind        as enum ('nlh','plo','plo5','lhe','mixed','stud','other');
create type promo_kind       as enum ('high_hand','bad_beat','splash_pot','freeroll','locals_rate','other');
create type run_reliability  as enum ('typically_runs','often_cancels','series_only','unknown');
create type amenity_group    as enum ('games','food_drink','parking','comfort','services');
create type source_status    as enum ('ok','partial','failing','idle');
create type change_state     as enum ('pending','approved','rejected','superseded');
create type change_op        as enum ('insert','update','delete');

-- ---------------------------------------------------------------------
-- MARKETS — the city is data. Reno later is a row, not a refactor.
-- ---------------------------------------------------------------------
create table markets (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,              -- 'las-vegas'
  name        text not null,
  timezone    text not null default 'America/Los_Angeles',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- SOURCES — the registry. This table IS the maintenance loop's to-do
-- list: one row per (room x data-type x URL).
-- ---------------------------------------------------------------------
create table sources (
  id                uuid primary key default gen_random_uuid(),
  room_id           uuid,                        -- FK added after rooms
  data_type         text not null,               -- 'tournaments' | 'promotions' | 'amenities' | 'cash' | 'hours'
  url               text not null,
  label             text,                        -- 'Orleans daily schedule PDF'
  parser            text,                        -- tier-1 parser key, null = manual/Cowork
  cadence_hours     integer not null default 24,
  status            source_status not null default 'idle',
  last_fetched_at   timestamptz,
  last_ok_at        timestamptz,
  last_error        text,
  -- PDFs get replaced at the same URL and go stale silently.
  -- A changed hash raises a pending_changes item.
  content_hash      text,
  created_at        timestamptz not null default now(),
  unique (url, data_type)
);

-- ---------------------------------------------------------------------
-- ROOMS
-- ---------------------------------------------------------------------
create table rooms (
  id                uuid primary key default gen_random_uuid(),
  market_id         uuid not null references markets(id),
  slug              text not null unique,        -- routes: /rooms/aria
  name              text not null,               -- 'Wynn/Encore'
  property          text,                        -- parent casino if different
  area              area_kind not null,
  status            room_status not null default 'open',

  -- WSOP-Paris: seasonal, off the roster and all counts by default,
  -- restored when the series is live. Modelled, never deleted.
  is_seasonal       boolean not null default false,
  season_start      date,
  season_end        date,

  -- A closed room keeps its page: /rooms/<slug> stays linked from search for
  -- months after a closure, and a 404 tells that visitor nothing. The page
  -- carries a DATED notice and points at the nearest open rooms, so the closure
  -- itself is a fact with provenance like any other. Undated closure is
  -- unrepresentable — see closure_is_dated below.
  closed_on         date,

  latitude          numeric(9,6) not null,
  longitude         numeric(9,6) not null,

  table_count       integer,                     -- sortable => numeric
  phone             text,
  website_url       text,
  hours_note        text,                        -- '24 hours' / 'Daily 10a-3a'
  is_24h            boolean,

  -- players club / comps
  loyalty_program   text,                        -- 'M life', 'Wynn Red Card'
  comp_rate_hourly  numeric(6,2),                -- $/hr, sortable
  comp_notes        text,

  -- first-timer basics
  dress_code        text,
  min_age           integer default 21,
  drinks_note       text,

  -- provenance (see also per-fact provenance on child tables)
  -- set null, not cascade: retiring a source must never delete a fact.
  source_id         uuid references sources(id) on delete set null,
  source_url        text,
  fetched_at        timestamptz,
  verified_at       timestamptz,                 -- NULL = unverified => never ranked

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- "Closed" without a date is the same failure as a fact without a source:
  -- the reader cannot tell a closure last week from one in 2021. The constraint
  -- makes the undated version impossible rather than merely discouraged.
  constraint closure_is_dated check (status <> 'closed' or closed_on is not null)
);

alter table sources
  add constraint sources_room_fk foreign key (room_id) references rooms(id) on delete cascade;

create index rooms_market_idx   on rooms(market_id);
create index rooms_area_idx     on rooms(area);
create index rooms_seasonal_idx on rooms(is_seasonal);
create index rooms_geo_idx      on rooms(latitude, longitude);

-- ---------------------------------------------------------------------
-- CASH GAMES — one row per game a room spreads (not live status).
-- ---------------------------------------------------------------------
create table cash_games (
  id                 uuid primary key default gen_random_uuid(),
  room_id            uuid not null references rooms(id) on delete cascade,

  game               game_kind not null,
  -- exact stakes: 1/2 vs 1/3 matters. Stored numerically so it sorts.
  small_blind        numeric(8,2),
  big_blind          numeric(8,2),
  bring_in           numeric(8,2),                -- stud: forced opening bet
  -- FIXED LIMIT: a $4/8 LHE is a small bet and a big bet — neither a blind
  -- nor a spread. Explicit columns, not a convention smuggled into the
  -- blind columns: big_blind carries the no-limit stakes sort
  -- (cash_games_stakes_idx), so a $4/8 limit game filed as big_blind = 8
  -- would rank beside $5/10 no-limit, a far bigger game. Overloading the
  -- column yields a wrong ranking, not merely an untidy one. Stud uses
  -- bring_in AND these; a mixed rotation may carry bets with no blinds.
  small_bet          numeric(8,2),
  big_bet            numeric(8,2),
  is_spread_limit    boolean not null default false,
  spread_min         numeric(8,2),
  spread_max         numeric(8,2),
  stakes_label       text not null,               -- '$1/3', '$1-5 spread' (display only)

  -- rake: two models, and they cannot be compared naively.
  -- NULL rake_type = the rake model is unknown. Horseshoe publishes no
  -- figure at all, and asserting 'pot' would be fabrication one level up
  -- from inventing the number. Deliberately NO default: an omitted
  -- rake_type must mean unknown, never a silent 'pot'.
  rake_type          rake_kind,
  rake_percent       numeric(5,2),                -- pot: 10.00
  rake_cap           numeric(8,2),                -- pot: 4.00
  jackpot_drop       numeric(8,2),                -- pot only: 1.00
  time_charge        numeric(8,2),                -- time: per player per half hour
  time_interval_min  integer default 30,

  -- RAKE GETS ITS OWN RECEIPT. Not full per-field provenance — that is
  -- over-engineering — but rake is the single most heavily ranked field
  -- in the product and drives the flagship superlative, and rake and
  -- stakes routinely live on different pages. The Orleans publishes its
  -- stakes on Boyd's own site and its cap nowhere but a third party. A
  -- ranked metric whose source_url does not support it is precisely the
  -- failure this system exists to prevent.
  --
  -- NULL means "the rake came from this row's own source_url" — read it
  -- as coalesce(rake_source_url, source_url), so the common case costs
  -- nothing. Populate it only when the rake was read somewhere else.
  -- rake_verified_at follows the same rule as every other verified_at:
  -- research never sets it, only a human on site does. Rake ranking
  -- gates on THIS column, not on the row's verified_at.
  rake_source_url    text,
  rake_fetched_at    timestamptz,
  rake_verified_at   timestamptz,

  min_buy_in         numeric(10,2),               -- most-asked question; sortable
  max_buy_in         numeric(10,2),               -- NULL = uncapped
  is_uncapped        boolean not null default false,

  table_count        integer,
  straddle_rule      text,
  must_post          boolean,
  structure_note     text,
  typical_hours      text,

  source_id          uuid references sources(id) on delete set null,
  source_url         text,
  fetched_at         timestamptz,
  verified_at        timestamptz,                 -- NULL => shown tilde'd, never ranked

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- A constraint prevents incoherence; it does not demand completeness.
  -- There is deliberately NO positive requirement: a pot game may carry a
  -- percent, a cap, both, or neither. "We do not know the rake" and "this
  -- game does not exist" are different claims, and the first is already
  -- handled by the provenance system — shown, tilde'd, never ranked, with
  -- the exclusion line naming the room and the reason. Rooms publishing a
  -- cap and no percentage (ARIA, Venetian, Orleans) are ordinary here.
  --
  -- What IS enforced: no row may carry a figure from a rake model it does
  -- not use. Rake is the headline ranked metric, and a stale value in an
  -- unused column is precisely what gets sorted on by mistake.
  constraint rake_model_coherent check (
    case
      when rake_type is null then                 -- model unknown: all silent
        rake_percent is null and rake_cap is null
        and jackpot_drop is null and time_charge is null
      when rake_type = 'pot' then
        time_charge is null
      when rake_type = 'time' then
        rake_percent is null and rake_cap is null and jackpot_drop is null
    end
  ),

  -- Ingestion re-runs must upsert, not duplicate. NULLS NOT DISTINCT
  -- because small_blind/big_blind are NULL for stud and spread-limit
  -- games, and Postgres's default treats every NULL as unique — which
  -- would silently exempt exactly the rows most likely to duplicate.
  -- Every stakes model is in the key, because under NULLS NOT DISTINCT a
  -- model that is absent from it collapses: without bring_in, two stud
  -- games at one room become one tuple; without the bets, $4/8 and $10/20
  -- limit do the same.
  constraint cash_games_natural_key unique nulls not distinct
    (room_id, game, small_blind, big_blind, bring_in, small_bet, big_bet,
     is_spread_limit, spread_min, spread_max)
);
create index cash_games_room_idx   on cash_games(room_id);
create index cash_games_stakes_idx on cash_games(big_blind);

-- ---------------------------------------------------------------------
-- AMENITIES — lookup + join, because the filter panel is dynamic
-- checkboxes grouped GAMES / FOOD & DRINK / PARKING / COMFORT / SERVICES.
-- ---------------------------------------------------------------------
create table amenity_types (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,            -- 'free_self_park', 'tableside_food'
  label         text not null,                   -- 'Free self-park'
  grp           amenity_group not null,
  sort_order    integer not null default 0,
  is_filterable boolean not null default true
);

create table room_amenities (
  room_id       uuid not null references rooms(id) on delete cascade,
  amenity_id    uuid not null references amenity_types(id) on delete cascade,
  available     boolean not null default true,
  detail        text,                            -- 'Grand Lux, 11a-11p'
  -- tableside food: link the actual menu. Nobody else does this.
  menu_url      text,
  rate          numeric(8,2),                    -- e.g. massage $/min
  source_id     uuid references sources(id) on delete set null,
  source_url    text,
  fetched_at    timestamptz,
  verified_at   timestamptz,
  primary key (room_id, amenity_id)
);
create index room_amenities_amenity_idx on room_amenities(amenity_id);

-- ---------------------------------------------------------------------
-- HOUSE RULES — label/value pairs. Exists nowhere else structured.
-- ---------------------------------------------------------------------
create table house_rules (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms(id) on delete cascade,
  label       text not null,                     -- 'Straddle'
  value       text not null,                     -- 'UTG only, live'
  sort_order  integer not null default 0,
  source_id   uuid references sources(id) on delete set null,
  source_url  text,
  fetched_at  timestamptz,
  verified_at timestamptz
);
create index house_rules_room_idx on house_rules(room_id);

-- ---------------------------------------------------------------------
-- TOURNAMENTS — recurring TEMPLATE generates dated INSTANCES.
-- Avoids hand-managing thousands of instance rows, and gives a stable
-- entity to hang history and reliability on.
-- ---------------------------------------------------------------------
create table tournament_series (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid references rooms(id) on delete set null,
  slug        text not null unique,
  name        text not null,                     -- 'Wynn Signature Series'
  starts_on   date,
  ends_on     date,

  -- provenance, same contract as every other content table
  source_id   uuid references sources(id) on delete set null,
  source_url  text,
  fetched_at  timestamptz,
  verified_at timestamptz
);

create table tournament_templates (
  id                uuid primary key default gen_random_uuid(),
  room_id           uuid not null references rooms(id) on delete cascade,
  series_id         uuid references tournament_series(id) on delete set null,
  slug              text not null unique,        -- routes: /tournaments/<slug>
  name              text not null,

  game              game_kind not null default 'nlh',
  start_time        time not null,
  -- days of week it runs: 0=Sun .. 6=Sat. NULL for one-offs.
  days_of_week      smallint[],

  -- money, broken out honestly. Convention: fee / total buy-in.
  entry_amount      numeric(10,2) not null,      -- to the prize pool
  fee_amount        numeric(10,2) not null,      -- the house's cut
  bounty_amount     numeric(10,2) default 0,
  staff_amount      numeric(10,2) default 0,
  total_buy_in      numeric(10,2)
    generated always as (entry_amount + fee_amount + coalesce(bounty_amount,0) + coalesce(staff_amount,0)) stored,
  -- Generated, not "computed on write" — this is a ranked column and a
  -- caller that forgets leaves a NULL that quietly drops out of a sort.
  -- The denominator is inlined rather than referencing total_buy_in:
  -- Postgres forbids a generated column referencing another one.
  -- NULLIF guards the freeroll case (entry 0 + fee 0) -> NULL, not 22012.
  fee_percent       numeric(5,2)
    generated always as (
      round(
        100 * fee_amount
        / nullif(entry_amount + fee_amount
                 + coalesce(bounty_amount,0) + coalesce(staff_amount,0), 0),
        2)
    ) stored,

  guarantee_amount  numeric(12,2),
  guarantee_is_estimated boolean not null default false,

  -- structure
  starting_stack    integer,
  level_minutes     integer,
  -- PACE = chips per level-hour. Depth is a big stack AND long levels,
  -- so the level term MULTIPLIES. Dividing rewards turbos.
  pace              numeric(12,2)
    generated always as (
      case when starting_stack is not null and level_minutes is not null
           then (starting_stack::numeric * level_minutes) / 60
      end
    ) stored,
  late_reg_level    integer,
  late_reg_close    time,
  reentry_allowed   boolean,
  reentry_note      text,

  -- editorial: nobody publishes whether a daily actually fires.
  -- Display only. Never sortable, never ordinalised.
  reliability       run_reliability not null default 'unknown',
  reliability_note  text,

  -- dailies link the room's PDF; series get transcribed levels
  structure_pdf_url text,
  structure_fetched_at timestamptz,

  source_id         uuid references sources(id) on delete set null,
  source_url        text,
  fetched_at        timestamptz,
  verified_at       timestamptz,

  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- 0=Sun .. 6=Sat. An out-of-range day silently never matches a query;
  -- an empty array claims a recurring event that runs on no day at all.
  constraint days_of_week_valid check (
    days_of_week is null
    or (cardinality(days_of_week) > 0
        and days_of_week <@ array[0,1,2,3,4,5,6]::smallint[])
  )
);
create index tt_room_idx   on tournament_templates(room_id);
create index tt_series_idx on tournament_templates(series_id);

-- full level-by-level structure: series events only
create table tournament_levels (
  template_id   uuid not null references tournament_templates(id) on delete cascade,
  level_number  integer not null,
  small_blind   integer not null,
  big_blind     integer not null,
  ante          integer default 0,
  minutes       integer not null,
  is_break      boolean not null default false,
  primary key (template_id, level_number)
);

-- generated dated occurrences
create table tournament_instances (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references tournament_templates(id) on delete cascade,
  starts_at     timestamptz not null,
  is_cancelled  boolean not null default false,
  cancel_note   text,
  created_at    timestamptz not null default now(),
  unique (template_id, starts_at)
);
create index ti_starts_idx on tournament_instances(starts_at);

-- ---------------------------------------------------------------------
-- PROMOTIONS — modelled now, surfaced later (page is parked).
-- No invented amounts: an unknown jackpot is NULL, not a guess.
-- ---------------------------------------------------------------------
create table promotions (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references rooms(id) on delete cascade,
  kind           promo_kind not null,
  name           text not null,
  amount         numeric(12,2),                  -- NULL when unknown
  amount_note    text,                           -- 'climbing', 'varies'
  schedule_note  text,                           -- 'every 30 min, 10a-2a'
  starts_on      date,
  ends_on        date,
  eligibility    text,                           -- 'must be seated at $1/3+'
  is_active      boolean not null default true,

  source_id      uuid references sources(id) on delete set null,
  source_url     text,
  fetched_at     timestamptz,
  verified_at    timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index promotions_room_idx on promotions(room_id);
create index promotions_kind_idx on promotions(kind);

-- =====================================================================
-- THE MAINTENANCE LOOP
-- Nothing automated writes to the tables above. Proposals land here.
-- =====================================================================

create table pending_changes (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid references sources(id) on delete set null,

  target_table  text not null,                   -- 'cash_games'
  target_id     uuid,                            -- NULL for inserts
  room_id       uuid references rooms(id) on delete cascade,  -- for filtering the queue
  operation     change_op not null default 'update',

  field         text,                            -- 'rake_cap'
  old_value     jsonb,
  new_value     jsonb not null,

  confidence    numeric(5,2),                    -- 0-100; >=90 bulk-approvable
  agent         text,                            -- 'tier1:orleans-schedule' | 'cowork'
  note          text,

  state         change_state not null default 'pending',
  source_url    text,
  fetched_at    timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewed_by   text,
  created_at    timestamptz not null default now()
);
create index pc_state_idx on pending_changes(state);
create index pc_room_idx  on pending_changes(room_id);
create index pc_conf_idx  on pending_changes(confidence desc);

create table change_log (
  id            uuid primary key default gen_random_uuid(),
  target_table  text not null,
  target_id     uuid,
  room_id       uuid,
  operation     change_op not null,
  field         text,
  old_value     jsonb,
  new_value     jsonb,
  source_id     uuid references sources(id) on delete set null,
  source_url    text,
  agent         text,
  applied_at    timestamptz not null default now(),
  applied_by    text
);
create index cl_target_idx  on change_log(target_table, target_id);
create index cl_applied_idx on change_log(applied_at desc);

-- user-submitted corrections ("report a correction" on every record)
create table corrections (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid references rooms(id) on delete cascade,
  target_table  text,
  target_id     uuid,
  message       text not null,
  contact       text,                            -- optional, anonymous by default
  handled       boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- FRESHNESS HELPER
-- Sorting must run on a number, never a label. The UI derives
-- "YESTERDAY" / "2 DAYS AGO" from this; NULL sorts last, ranked '—'.
-- security_invoker: a view runs as its owner by default, which would
-- bypass RLS on rooms. Harmless while rooms is public-read, wrong the
-- moment it isn't — and flagged by Supabase's linter either way.
-- ---------------------------------------------------------------------
create or replace view room_freshness
  with (security_invoker = true) as
select
  r.id as room_id,
  r.slug,
  r.verified_at,
  case when r.verified_at is null then null
       else floor(extract(epoch from (now() - r.verified_at)) / 86400)::int
  end as verified_days
from rooms r;

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- Empty search_path so the function can't be hijacked by a schema
-- planted ahead of it. now() lives in pg_catalog, which is always
-- implicitly in scope, so nothing here needs schema-qualifying.
-- ---------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger rooms_touch      before update on rooms
  for each row execute function touch_updated_at();
create trigger cash_games_touch before update on cash_games
  for each row execute function touch_updated_at();
create trigger tt_touch         before update on tournament_templates
  for each row execute function touch_updated_at();
create trigger promotions_touch before update on promotions
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- RLS — public site is read-only; writes go through the service role
-- (ingestion + admin queue). No user accounts in v1.
-- ---------------------------------------------------------------------
alter table rooms                enable row level security;
alter table cash_games           enable row level security;
alter table amenity_types        enable row level security;
alter table room_amenities       enable row level security;
alter table house_rules          enable row level security;
alter table tournament_templates enable row level security;
alter table tournament_levels    enable row level security;
alter table tournament_instances enable row level security;
alter table tournament_series    enable row level security;
alter table promotions           enable row level security;
alter table markets              enable row level security;

create policy public_read_rooms      on rooms                for select using (true);
create policy public_read_cash       on cash_games           for select using (true);
create policy public_read_amen_types on amenity_types        for select using (true);
create policy public_read_room_amen  on room_amenities       for select using (true);
create policy public_read_rules      on house_rules          for select using (true);
create policy public_read_tt         on tournament_templates for select using (true);
create policy public_read_levels     on tournament_levels    for select using (true);
create policy public_read_ti         on tournament_instances for select using (true);
create policy public_read_series     on tournament_series    for select using (true);
create policy public_read_promos     on promotions           for select using (true);
create policy public_read_markets    on markets              for select using (true);

-- corrections: anyone may submit, nobody may read back
alter table corrections enable row level security;
create policy public_insert_corrections on corrections for insert with check (true);

-- sources / pending_changes / change_log: service role only (no policies).
alter table sources         enable row level security;
alter table pending_changes enable row level security;
alter table change_log      enable row level security;

-- ---------------------------------------------------------------------
-- GRANTS — RLS IS NECESSARY BUT NOT SUFFICIENT.
--
-- Postgres requires BOTH a table privilege AND a permissive policy. Every
-- policy above is inert without these grants, and this is not theoretical:
-- with the policies in place and the grants missing, PostgREST answered
--   42501 permission denied for table rooms
-- to every single request, for anon AND for service_role. The whole API
-- surface was dead, public and admin alike, while the schema looked
-- perfectly correct — 15/15 tables RLS-enabled, 12 policies, no errors.
--
-- The cause: Supabase's default privileges for the `postgres` role in
-- `public` grant anon/authenticated/service_role only Dxtm — TRUNCATE,
-- REFERENCES, TRIGGER, MAINTAIN. No SELECT, INSERT, UPDATE or DELETE.
-- Tables created by a migration therefore start unreadable by design.
--
-- service_role holds BYPASSRLS, which is why it is easy to assume it needs
-- nothing here. BYPASSRLS skips the POLICY check; it does not confer the
-- PRIVILEGE. It was as broken as anon.
--
-- These grants cover tables existing at this point in the migration only.
-- ANY FUTURE MIGRATION THAT ADDS A TABLE MUST ADD ITS OWN GRANTS.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

-- Public site: read-only, and only the content tables. sources,
-- pending_changes and change_log are deliberately absent — the public
-- never reads the maintenance loop. Note the receipts the UI renders are
-- plain text columns (source_url), not joins to sources, so read access
-- to the registry is genuinely not required.
grant select on
  markets, cash_games, amenity_types, room_amenities, house_rules,
  tournament_series, tournament_templates, tournament_levels,
  tournament_instances, promotions, room_freshness
to anon, authenticated;

-- Corrections: submit only, never read back. The policy already enforces
-- this; withholding SELECT enforces it a second way at the privilege
-- layer, so a future permissive policy cannot silently open it.
grant insert on corrections to anon, authenticated;

-- Service role: ingestion and the admin review queue.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
