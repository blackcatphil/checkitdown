-- =====================================================================
-- THE REST DOOR 021 LEFT OPEN. 2026-08-12. PROPOSED — not applied.
-- =====================================================================
-- ⚠️ REVOKING FROM public, anon AND authenticated IS NOT THE SAME AS REVOKING
-- FROM EVERYBODY, AND THIS IS THE SECOND TIME THAT HAS COST SOMETHING.
--
-- Migration 021 revoked EXECUTE on the three growth functions from `public`,
-- `anon` and `authenticated`, and never mentioned `service_role`. Hosted
-- Supabase grants it anyway. Measured on production after 021 landed:
--
--   record_events        postgres | cid_events_writer
--   growth_weekly        postgres | service_role | cid_events_writer
--   growth_refreshed_at  postgres | service_role | cid_events_writer
--   growth_room_counts   postgres | service_role | cid_events_writer
--
-- `record_events` is the control: migration 017 revoked service_role EXPLICITLY
-- and it is clean. The three functions written without that line are not. Same
-- trap, same schema, four weeks apart.
--
-- ⚠️ WHY IT MATTERS HERE AND NOT ELSEWHERE. The `analytics` schema's whole
-- design is that NOTHING reaches it over REST — that is the strongest of the
-- three locks 017 describes, and it is the reason the console reads through a
-- pooled Postgres connection as `cid_events_writer` rather than through
-- supabase-js. A service_role grant is a REST route into the roll-up, and an
-- unused door is the one nobody notices being walked through.
--
-- The app holds no service key (`lib/supabase-admin.ts`), so nothing is broken
-- by closing this. That is exactly why it should be closed now rather than
-- after something starts depending on it.
revoke execute on function public.growth_weekly() from service_role;
revoke execute on function public.growth_refreshed_at() from service_role;
revoke execute on function public.growth_room_counts() from service_role;

-- =====================================================================
-- THE AUDIT THIS CAME FROM, RECORDED SO IT IS NOT REPEATED FROM SCRATCH
-- =====================================================================
-- Every SECURITY DEFINER function in `public` was checked against PRODUCTION's
-- `proacl` — not locally, because the whole failure mode is a hosted default
-- that local does not apply. Twelve exist. The three above were the only
-- anomaly, and the other nine are correct for reasons worth writing down:
--
--   record_events            cid_events_writer only. 017 closed it deliberately.
--
--   approve_change           anon | authenticated, AND EACH AUTHORISES
--   approve_change_group     INTERNALLY — they raise 42501 for a caller who is
--   reject_change            not an admin. They are meant to be reachable over
--   detector_status          REST by a signed-in admin; the grant is the design,
--   pending_source_groups    and the check is in the body.
--
--   is_admin()               anon | authenticated, and MUST BE. Every RLS policy
--                            calls it. It takes NO ARGUMENTS and answers only
--                            about the caller via auth.jwt(), so it cannot be
--                            used to enumerate anybody else — it reads `admins`,
--                            which anon cannot read directly, and tells you one
--                            bit about yourself. Not an oracle.
--
--   fact_source_kind         anon | authenticated, no internal check, and that
--   source_kind_of           is fine: both are pure lookups over rooms,
--                            cash_games, room_amenities, room_descriptions and
--                            sources — all publicly readable already. They
--                            expose nothing a SELECT would not.
--
-- ⚠️ THE RULE THIS LEAVES BEHIND: a new SECURITY DEFINER function in `public`
-- must state what it grants AND what it revokes, service_role included. Silence
-- is not a revocation on hosted Supabase.

-- =====================================================================
-- TELLING A STALE ROLL-UP FROM A STOPPED PRODUCER
-- =====================================================================
-- ⚠️ ON 17 AUGUST THE ENGINE READS OVERDUE, AND THE CAUSE WILL BE A MISSING
-- SCHEDULER. 021's comment describes an hourly refresh and 021 ships no
-- scheduler; nothing calls `analytics.refresh_weekly()`. So the first time the
-- date does its job it will be a TRUE FAULT FOR A FALSE REASON, and whoever
-- reads it goes looking for a broken producer that is working perfectly.
--
-- `growth_refreshed_at()` already answers half the question. This answers the
-- other half: the newest event the roll-up's own source can see. Current view +
-- no events = the producer stopped. Stale view + events arriving = a scheduler
-- is missing. The console prints whichever, by name.
create or replace function public.growth_latest_event()
returns timestamptz
language sql
security definer
set search_path = ''
as $$ select max(occurred_at) from analytics.events where not is_internal and not bot $$;

-- ⚠️ AND THE REVOKE THIS MIGRATION EXISTS TO REMEMBER, on the new function too.
revoke all on function public.growth_latest_event() from public;
revoke all on function public.growth_latest_event() from anon, authenticated, service_role;
grant execute on function public.growth_latest_event() to cid_events_writer;

-- ⚠️ AND THE EARLIEST EVENT, FOR THE SAME REASON — read from the SOURCE, not
-- from the roll-up.
--
-- The console derived "when did this start" from the roll-up's own first week.
-- That is circular: when the matview is stale it holds no weeks, so the date
-- cannot be computed, so every cell renders as "no producer exists" — a STALE
-- VIEW WEARING THE COSTUME OF AN ABSENT ONE, which is the single confusion this
-- console was built to prevent. Caught by red-proving the stale case.
create or replace function public.growth_earliest_event()
returns timestamptz
language sql
security definer
set search_path = ''
as $$ select min(occurred_at) from analytics.events where not is_internal and not bot $$;

revoke all on function public.growth_earliest_event() from public;
revoke all on function public.growth_earliest_event() from anon, authenticated, service_role;
grant execute on function public.growth_earliest_event() to cid_events_writer;
