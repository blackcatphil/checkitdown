-- =====================================================================
-- THE WEEKLY ROLL-UP. 2026-08-12. PROPOSED — not applied to production.
-- =====================================================================
-- Every figure the growth console shows comes from here, and every definition
-- is a line of SQL somebody can read and disagree with. That is the point: a
-- metric whose definition lives in application code is a metric nobody can
-- audit, and "weekly active people" is a phrase four people will define five
-- ways.
--
-- ═══ ⚠️ ISO WEEKS, AND ONLY COMPLETE ONES ═══
--
-- `date_trunc('week', ...)` is ISO — weeks start Monday. The view includes the
-- CURRENT, INCOMPLETE week as a row, because excluding it would make "no data"
-- and "the week is not over" indistinguishable. The `is_complete` column is how
-- a caller tells them apart, and the console must never present an incomplete
-- week as a reading.
--
-- ═══ ⚠️ NEW REACH IS WHY analytics.devices EXISTS ═══
--
-- "Devices with no prior event EVER" cannot be computed from `events` alone once
-- retention starts deleting: after 90 days a returning reader looks new. So new
-- reach joins `analytics.devices`, which is never deleted and whose
-- `first_seen_at` is written once and never updated (migration 017). A device is
-- new in the week its first_seen_at falls in — not the week we first saw an
-- event we still hold.
--
-- ═══ REFRESH ═══
--
-- `refresh materialized view concurrently analytics.weekly` — called hourly by
-- a scheduled job, and by hand after an ingest. NOTHING HERE IS REAL-TIME and
-- the console says so: it reads `analytics.rollup_refreshed_at()` and prints it.
-- A dashboard that looks live and is an hour stale is worse than one that
-- states its age, because only the second one can be trusted at a glance.
-- CONCURRENTLY requires a unique index, which is why one exists on iso_week.
-- =====================================================================

-- ---------------------------------------------------------------------
-- WHAT COUNTS AS A DECISION
-- ---------------------------------------------------------------------
-- ⚠️ NOT EVERY EVENT. `map_filter_apply` is somebody browsing; `install_accept`
-- is an outcome, not a visit. The decision surface is the four events that mean
-- a person was looking at a ROOM'S FACTS and acting on them, which is what this
-- product is for. Stated as a function so the console's Spec tab can print the
-- same list the queries use rather than a copy of it.
create or replace function analytics.decision_events()
returns analytics.event_name[]
language sql immutable as $$
  select array['room_facts_view', 'outbound_room_click',
               'source_link_click', 'tournament_row_open']::analytics.event_name[]
$$;

comment on function analytics.decision_events() is
  'The events that mean somebody was reading a room''s facts and acting on '
  'them. map_filter_apply is browsing and install_accept is an outcome; '
  'neither is a decision. The Spec tab prints this list.';

-- ---------------------------------------------------------------------
-- THE ROLL-UP
-- ---------------------------------------------------------------------
create materialized view analytics.weekly as
with
/* ⚠️ ONE FILTER, APPLIED ONCE. `is_internal` is our own traffic and `bot` is
   the classifier's answer — excluding them in one place means no metric below
   can silently disagree with another about who counted. */
real_events as (
  select e.*, date_trunc('week', e.occurred_at)::date as iso_week
    from analytics.events e
   where not e.is_internal and not e.bot
),
decisions as (
  select * from real_events where event_name = any (analytics.decision_events())
),
/* Every week that has any real event, plus the current one so an empty current
   week is a row rather than a gap. */
weeks as (
  select iso_week from decisions
  union
  select date_trunc('week', now())::date
),
active as (
  select w.iso_week, d.device_id
    from weeks w join decisions d on d.iso_week = w.iso_week
   group by 1, 2
),
outbound as (
  select iso_week, device_id from real_events
   where event_name = 'outbound_room_click' group by 1, 2
)
select
  w.iso_week,
  (w.iso_week + interval '6 days')::date as week_ends,

  /* COMPLETE means the week has finished. The console refuses to present an
     incomplete week as a reading; see the header. */
  (w.iso_week < date_trunc('week', now())::date) as is_complete,

  /* WAP — distinct devices that made at least one decision. */
  (select count(distinct a.device_id) from active a where a.iso_week = w.iso_week)::int
    as weekly_active_people,

  /* NEW REACH — devices whose FIRST EVER sighting falls in this week AND which
     made a decision in it.
     ⚠️ THE SECOND HALF IS NOT OPTIONAL, and the first version omitted it.
     `analytics.devices` carries a token and a date and nothing else — it has no
     `is_internal` and no `bot`, because it is deliberately the smallest table
     that can answer "ever". So counting it alone counts OUR OWN TESTING and
     every crawler that ever loaded a page. Red-proved: WAP correctly held at 1
     while this read 3 after an internal device and a bot were added.
     Joining back to `active` applies the same single filter every other metric
     uses, while `first_seen_at` still supplies the unbounded history that
     survives the 90-day window. */
  (select count(*) from analytics.devices dv
    where date_trunc('week', dv.first_seen_at)::date = w.iso_week
      and exists (select 1 from active a
                   where a.iso_week = w.iso_week and a.device_id = dv.device_id))::int
    as new_reach,

  /* ACTIVATION — of the devices active this week, how many reached the point of
     leaving for a room's own document. That is the action this product exists
     to produce; a view without one is a visit, not an activation. */
  (select count(*) from outbound o where o.iso_week = w.iso_week)::int
    as activated,

  /* PRIOR-WEEK ACTIVE — the denominator for return rate, carried here so the
     console never has to compute across rows. */
  (select count(distinct a.device_id) from active a
    where a.iso_week = w.iso_week - 7)::int as prior_week_active,

  /* 7-DAY RETURN — devices active this week that were ALSO active last week.
     A count, not a rate: the console divides, and divides only when the
     denominator is a complete week. */
  (select count(*) from active a
    where a.iso_week = w.iso_week
      and exists (select 1 from active p
                   where p.iso_week = w.iso_week - 7 and p.device_id = a.device_id))::int
    as returned_from_prior,

  /* OUTBOUND EVENTS — the raw count, distinct from `activated` which counts
     DEVICES. A room with one very busy reader is not ten interested ones. */
  (select count(*) from real_events e
    where e.iso_week = w.iso_week and e.event_name = 'outbound_room_click')::int
    as outbound_clicks

from weeks w
order by w.iso_week;

/* Required for REFRESH ... CONCURRENTLY. */
create unique index weekly_iso_week_idx on analytics.weekly (iso_week);

comment on materialized view analytics.weekly is
  'One row per ISO week. Every growth-console figure comes from here. '
  'is_complete distinguishes a finished week from the one in progress — the '
  'console must never present an incomplete week as a reading.';

-- ---------------------------------------------------------------------
-- WHEN WAS THIS LAST TRUE?
-- ---------------------------------------------------------------------
-- ⚠️ A DASHBOARD THAT DOES NOT STATE ITS AGE IS READ AS LIVE. This is refreshed
-- hourly at best, so the console prints the refresh time beside the numbers.
create table analytics.rollup_meta (
  only_row boolean primary key default true check (only_row),
  refreshed_at timestamptz not null default now()
);
insert into analytics.rollup_meta default values;

create or replace function analytics.refresh_weekly()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  refresh materialized view concurrently analytics.weekly;
  update analytics.rollup_meta set refreshed_at = now();
end $$;

create or replace function analytics.rollup_refreshed_at()
returns timestamptz
language sql stable
security definer
set search_path = ''
as $$ select refreshed_at from analytics.rollup_meta $$;

-- ---------------------------------------------------------------------
-- ⚠️ THE SAME LOCKS THE EVENTS TABLE HAS
-- ---------------------------------------------------------------------
-- `analytics` is not exposed to PostgREST, so none of this has a REST route.
-- The console reads it as `postgres` over a pooled connection, the way every
-- other admin read in this repo works. Nothing is granted to anon or
-- authenticated, and the grant is stated rather than left as an absence.
revoke all on analytics.weekly from anon, authenticated;
revoke all on analytics.rollup_meta from anon, authenticated;
revoke all on function analytics.refresh_weekly() from public;
revoke all on function analytics.rollup_refreshed_at() from public;

-- ---------------------------------------------------------------------
-- THE READ DOOR
-- ---------------------------------------------------------------------
-- ⚠️ THE SAME SHAPE AS `public.record_events`, AND FOR THE SAME REASON. The
-- `analytics` schema is deliberately not exposed to PostgREST, so supabase-js
-- cannot reach this view with any key — that is the strongest lock on the
-- events table and migration 017 exists to keep it. The console therefore reads
-- through a SECURITY DEFINER function in `public`, over the same pooled
-- connection the write path uses, as `cid_events_writer`.
--
-- EXECUTE is granted to that role ONLY. anon and authenticated are revoked
-- explicitly, so a browser holding the anon key gets 404 from PostgREST and
-- nothing from here.
create or replace function public.growth_weekly()
returns table (
  iso_week date, week_ends date, is_complete boolean,
  weekly_active_people int, new_reach int, activated int,
  prior_week_active int, returned_from_prior int, outbound_clicks int
)
language sql
security definer
set search_path = ''
as $$ select * from analytics.weekly order by iso_week $$;

/* The console prints this beside the numbers. A dashboard that does not state
   its age is read as live. */
create or replace function public.growth_refreshed_at()
returns timestamptz
language sql
security definer
set search_path = ''
as $$ select analytics.rollup_refreshed_at() $$;

/* ⚠️ REVOKE FROM PUBLIC FIRST. Postgres grants EXECUTE to PUBLIC by default at
   creation, so a `grant ... to cid_events_writer` on its own narrows nothing —
   the same trap migration 017 documents. */
revoke all on function public.growth_weekly() from public;
revoke all on function public.growth_refreshed_at() from public;
revoke all on function public.growth_weekly() from anon, authenticated;
revoke all on function public.growth_refreshed_at() from anon, authenticated;
grant execute on function public.growth_weekly() to cid_events_writer;
grant execute on function public.growth_refreshed_at() to cid_events_writer;

-- ---------------------------------------------------------------------
-- PER-ROOM COUNTS, ROLLING 7 DAYS
-- ---------------------------------------------------------------------
-- ⚠️ THE LEDGER HELD THESE BACK UNTIL A PRODUCER EXISTED. One does now. A room
-- returning 0 has been MEASURED — the producer ran and found nothing — which is
-- a finding about the room, not an absence in our checking. The console renders
-- it as 0 for exactly that reason.
--
-- Rolling seven days rather than a complete week: this answers "is anybody
-- looking at this room right now", which needs no week boundary. The 7-day
-- DELTA does, and the console shows it as pending until two complete weeks
-- exist.
create or replace function public.growth_room_counts()
returns table (room_slug text, sessions int, outbound int)
language sql
security definer
set search_path = ''
as $$
  select r.slug,
         count(distinct e.session_id)::int,
         count(*) filter (where e.event_name = 'outbound_room_click')::int
    from public.rooms r
    left join analytics.events e
      on e.room_id = r.id
     and e.occurred_at >= now() - interval '7 days'
     and not e.is_internal and not e.bot
   group by r.slug
$$;

revoke all on function public.growth_room_counts() from public;
revoke all on function public.growth_room_counts() from anon, authenticated;
grant execute on function public.growth_room_counts() to cid_events_writer;
