-- =====================================================================
-- THE THIRD TERM, AND A FUNNEL THAT COMPARES LIKE WITH LIKE. 2026-08-15.
-- PROPOSED — not applied.
-- =====================================================================
-- Two columns on `analytics.weekly`, for two different complaints.
--
-- ⚠️ A MATERIALISED VIEW CANNOT GAIN A COLUMN. It is dropped and rebuilt
-- below, which also drops `weekly_iso_week_idx` — recreated, because
-- `refresh materialized view concurrently` REQUIRES a unique index and the
-- hourly refresh silently becomes a blocking refresh without it. The grants
-- are restated for the same reason 022 exists: silence is not a revocation.
--
-- ---------------------------------------------------------------------
-- ⚠️ THE BRIEF'S DEFINITION OF new_activated IS DEGENERATE, AND THIS IS NOT IT
-- ---------------------------------------------------------------------
-- The brief asks for "devices whose first_seen_at is in this week AND that
-- reached a decision surface in it". That is already `new_reach`, word for
-- word — migration 021 defines it as first-ever sighting in this week AND a
-- decision in it, and the comment there records that the second half is not
-- optional. So row 1 of the equation would read
--
--     new_reach × (new_reach ÷ new_reach) = new_reach
--
-- which is 100% forever and answers nothing.
--
-- The INTENT in the brief is not ambiguous — "are newcomers converting" — and
-- conversion in this product has one meaning already fixed by `activated`:
-- reaching the point of leaving for a room's own document. So `new_activated`
-- is that same act, restricted to devices seen for the first time this week.
-- The equation then reads
--
--     new_reach × (new_activated ÷ new_reach) = new_activated
--
-- and asks a real question: of the newcomers who got as far as a decision
-- surface, how many went to a room. The population lines up on both sides,
-- which was the objection this is answering.
--
-- ⚠️ IF THAT IS THE WRONG READING, THIS COLUMN IS THE THING TO CHANGE, and it
-- has not been applied anywhere yet.
--
-- ---------------------------------------------------------------------
-- REACTIVATED, AND WHY THE TWO-TERM SUM WAS WRONG
-- ---------------------------------------------------------------------
-- The prototype's sum strip reads `new + retained = weekly active`. Ours could
-- not, and the gap is not rounding: a device seen three weeks ago, silent last
-- week, opening the app tonight to decide where to play is in NEITHER term. It
-- is not new, and it did not return from the prior week. On a product people
-- open when they are deciding where to play tonight, that population is
-- plausibly the largest of the three, and a sum that drops it silently would
-- be wrong by however big it is.
--
-- The three terms partition the week's active devices exactly:
--
--   new_reach          first seen this week            (cannot have been active before)
--   returned_from_prior seen before, active last week
--   reactivated        seen before, NOT active last week
--
-- They are disjoint by construction — a device first seen this week has no
-- prior week to have been active in — and together they are every device in
-- `active`. The identity is asserted at the bottom of this file rather than
-- assumed, because "the definitions disagree" is exactly the thing that would
-- otherwise be found by someone reading a wrong total off a screen.

drop materialized view if exists analytics.weekly;

create materialized view analytics.weekly as
with
/* ⚠️ ONE FILTER, APPLIED ONCE — unchanged from 021, and copied rather than
   referenced because a materialised view cannot select from its own CTEs
   across a rebuild. If this diverges from 021's copy the metrics disagree
   about who counted, so it is the first thing to check on any change. */
real_events as (
  select e.*, date_trunc('week', e.occurred_at)::date as iso_week
    from analytics.events e
   where not e.is_internal and not e.bot
),
decisions as (
  select * from real_events where event_name = any (analytics.decision_events())
),
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
),
/* Devices seen for the first time in a given week. Kept as a CTE because three
   columns below ask about it and each one asking separately is three chances
   to phrase it differently. */
first_seen as (
  select device_id, date_trunc('week', first_seen_at)::date as iso_week
    from analytics.devices
)
select
  w.iso_week,
  (w.iso_week + interval '6 days')::date as week_ends,
  (w.iso_week < date_trunc('week', now())::date) as is_complete,

  (select count(distinct a.device_id) from active a where a.iso_week = w.iso_week)::int
    as weekly_active_people,

  (select count(*) from first_seen f
    where f.iso_week = w.iso_week
      and exists (select 1 from active a
                   where a.iso_week = w.iso_week and a.device_id = f.device_id))::int
    as new_reach,

  (select count(*) from outbound o where o.iso_week = w.iso_week)::int
    as activated,

  /* NEW ACTIVATED — the numerator of the newcomer funnel. Same act as
     `activated`, same table, restricted to devices whose first sighting is this
     week. It is a SUBSET of `new_reach` by construction: reaching an outbound
     click requires a decision event, so anything counted here is already
     counted there, and the ratio cannot exceed 1. */
  (select count(*) from first_seen f
    where f.iso_week = w.iso_week
      and exists (select 1 from outbound o
                   where o.iso_week = w.iso_week and o.device_id = f.device_id))::int
    as new_activated,

  (select count(distinct a.device_id) from active a
    where a.iso_week = w.iso_week - 7)::int as prior_week_active,

  (select count(*) from active a
    where a.iso_week = w.iso_week
      and exists (select 1 from active p
                   where p.iso_week = w.iso_week - 7 and p.device_id = a.device_id))::int
    as returned_from_prior,

  /* REACTIVATED — active this week, seen before this week, and NOT active last
     week. The third term of the sum, and the one the prototype drops. */
  (select count(*) from active a
    where a.iso_week = w.iso_week
      and exists (select 1 from first_seen f
                   where f.device_id = a.device_id and f.iso_week < w.iso_week)
      and not exists (select 1 from active p
                       where p.iso_week = w.iso_week - 7 and p.device_id = a.device_id))::int
    as reactivated,

  (select count(*) from real_events e
    where e.iso_week = w.iso_week and e.event_name = 'outbound_room_click')::int
    as outbound_clicks

from weeks w
order by w.iso_week;

/* Required for REFRESH ... CONCURRENTLY. Dropped with the view above. */
create unique index weekly_iso_week_idx on analytics.weekly (iso_week);

comment on materialized view analytics.weekly is
  'One row per ISO week. Every growth-console figure comes from here. '
  'is_complete distinguishes a finished week from the one in progress — the '
  'console never presents an incomplete week as a reading. '
  'weekly_active_people = new_reach + returned_from_prior + reactivated, '
  'exactly; the three are disjoint and cover the week.';

-- ⚠️ RESTATED, NOT ASSUMED. The drop took the grants with it.
revoke all on analytics.weekly from anon, authenticated;

-- ---------------------------------------------------------------------
-- THE READ DOOR HAS TO LEARN THE NEW SHAPE
-- ---------------------------------------------------------------------
-- ⚠️ `growth_weekly()` IS `select *` AGAINST A DECLARED RETURN TABLE, so the
-- column ORDER here has to match the view above position for position. Getting
-- it wrong does not error at creation — it errors at call time, or worse,
-- returns the right types in the wrong columns.
--
-- ⚠️ AND IT MUST BE DROPPED FIRST. `create or replace` CANNOT change a
-- function's return type — Postgres refuses with "cannot change return type of
-- existing function", because the OUT parameters ARE the row type. Measured on
-- the first local apply of this file. Dropping also drops the grants, so they
-- are restated below rather than assumed to have survived.
drop function if exists public.growth_weekly();

create function public.growth_weekly()
returns table (
  iso_week date, week_ends date, is_complete boolean,
  weekly_active_people int, new_reach int, activated int, new_activated int,
  prior_week_active int, returned_from_prior int, reactivated int,
  outbound_clicks int
)
language sql
security definer
set search_path = ''
as $$ select * from analytics.weekly order by iso_week $$;

revoke all on function public.growth_weekly() from public;
revoke all on function public.growth_weekly() from anon, authenticated, service_role;
grant execute on function public.growth_weekly() to cid_events_writer;

-- ---------------------------------------------------------------------
-- THE IDENTITY, ASSERTED RATHER THAN BELIEVED
-- ---------------------------------------------------------------------
-- ⚠️ IF THE THREE TERMS DO NOT SUM TO THE TOTAL, THE DEFINITIONS DISAGREE and
-- this migration refuses to finish. A partition that is wrong by one device is
-- a sum strip that is wrong forever, and it would be found by someone reading
-- a total off a screen and not believing it.
--
-- ⚠️ AND IT IS VACUOUS WITHOUT ALL THREE POPULATIONS — MEASURED, NOT FEARED.
-- Applying this file with `reactivated` deliberately broken to always return 0
-- printed `DO` and passed, because the database at that moment held only
-- first-seen-this-week devices: 14 = 14 + 0 + 0 is a true statement about a
-- partition that is broken. `scripts/migration-023-gate.mjs` builds a
-- returning device and a reactivated one and then fails on exactly that
-- injection. This block is the cheap guard; the gate is the real one.
do $$
declare bad int;
begin
  select count(*) into bad from analytics.weekly
   where weekly_active_people <> new_reach + returned_from_prior + reactivated;
  if bad > 0 then
    raise exception
      'the weekly partition does not hold on % week(s): '
      'weekly_active_people <> new_reach + returned_from_prior + reactivated. '
      'The three terms are meant to be disjoint and complete; one of the '
      'definitions has drifted.', bad;
  end if;

  select count(*) into bad from analytics.weekly where new_activated > new_reach;
  if bad > 0 then
    raise exception
      'new_activated exceeds new_reach on % week(s), which cannot happen: '
      'an outbound click requires a decision event, so every new_activated '
      'device is already a new_reach device.', bad;
  end if;
end $$;
