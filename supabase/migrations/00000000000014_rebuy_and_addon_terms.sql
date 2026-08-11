-- =====================================================================
-- REBUY AND ADD-ON ECONOMICS. 2026-08-11.
-- =====================================================================
-- Cost comparison is what this product is for, and the real cost of two rooms'
-- events is currently unrankable because the terms sit in `reentry_note` as
-- free text:
--
--   "Re-entry is NOT allowed. Unlimited $200 rebuys at 15,000 chips or less,
--    and one $100 add-on, until the start of level 9 (approximately 4:30 p.m.)."
--
-- A reader can price that. Nothing else can: it cannot be sorted, cannot be
-- compared against Caesars, and cannot be checked for internal contradiction.
--
-- ⚠️ THE NOTE DOES NOT GO AWAY. It stays as the verbatim transcription and
-- these columns are proven consistent with it — `lib/tournament-terms.ts`
-- parses the note and a unit test asserts the parse equals what is stored, for
-- every row. Same ruling as the Wynn dailies pair: two representations, gate
-- the pair. Deleting the prose would delete the thing the columns are checked
-- against, and it is also the only place a room's own wording survives.
--
-- =====================================================================
-- 1. ⚠️ "15,000 CHIPS" MEANS TWO DIFFERENT THINGS IN THE TWO DOCUMENTS
-- =====================================================================
-- This is the finding that shaped the whole table, and it would have been
-- invisible under a single `rebuy_chips` column.
--
--   WYNN:     "unlimited $200 rebuys AT 15,000 CHIPS OR LESS"
--             15,000 is an ELIGIBILITY THRESHOLD. You may rebuy only while
--             your stack is at or below it. It says nothing about what you
--             receive.
--   CAESARS:  "$50 add-on FOR 15,000 CHIPS"
--             15,000 is what you GET.
--
-- Same number, same document family, opposite meanings. Collapsing them into
-- one column gives a reader "rebuy $200 for 15,000 chips" at Wynn — a sentence
-- that is wrong in a way that costs money, produced by a schema that looked
-- tidy. So they are separate columns with separate names, and the Wynn one is
-- `rebuy_max_stack` rather than anything with `chips` in it.
--
-- What Wynn's $200 rebuy actually BUYS is not published. `rebuy_chips` is
-- therefore NULL for all four dailies, and NULL here means what it means
-- everywhere else in this schema: the room does not publish it.
--
-- =====================================================================
-- 2. ⚠️ NULL IS NOT "UNLIMITED". THIS IS A DELIBERATE DEPARTURE.
-- =====================================================================
-- The obvious shape is `rebuy_max integer` with NULL meaning unlimited. It is
-- rejected here, and the reason is not style.
--
-- NULL ALREADY MEANS SOMETHING IN THIS DATABASE, everywhere, and it means "we
-- do not hold this". `no row is no check`; a null `document_effective_on`
-- reads as "the room publishes no date"; a null amenity is not a confirmed
-- absence. Overloading NULL on ONE column to mean a positive claim —
-- "unlimited, and we know it" — breaks that convention silently, and it makes
-- two genuinely different states indistinguishable:
--
--     a room that publishes "unlimited rebuys"          -> unlimited
--     a room that publishes rebuys and no count at all  -> unknown
--
-- Under NULL-as-unlimited the second becomes the first, and the surface would
-- print "unlimited rebuys" about a room that never said so. That is the
-- manufactured-fact class exactly.
--
-- So the claim gets its own column. `rebuy_unlimited` is NOT NULL DEFAULT
-- false because "we are not claiming unlimited" is the honest resting state for
-- every one of the 26 existing rows, and a nullable boolean would give this
-- table a three-valued flag nobody needs.
--
-- =====================================================================
-- 3. RE-ENTRY AND REBUY ARE DIFFERENT THINGS, AND ONE ROW PROVES IT
-- =====================================================================
-- Wynn's Friday event is `reentry_allowed = false` AND has unlimited rebuys. A
-- re-entry is a new entry after busting; a rebuy tops up a stack you are still
-- sitting behind. Any constraint tying one to the other — "rebuys imply
-- re-entry", "no re-entry means no rebuys" — would refuse a real event that is
-- already in this database. There is deliberately no such constraint, and this
-- paragraph exists so nobody adds one.
--
-- =====================================================================
-- 4. WHEN AN OFFER MAY BE TAKEN
-- =====================================================================
-- Two shapes are published between the two rooms and both must be storable
-- without free text:
--
--   WYNN     the add-on and the rebuys run "until the start of level 9",
--            which is the same moment registration closes -> through_late_reg
--   CAESARS  the add-on is takeable "at the first break" only -> first_break
--
-- An enum, not text, and deliberately a SHORT one. A third shape is a new fact
-- shape and should cost a migration and a review — that friction is the point.
-- The alternative, a free-text window, is the thing this migration exists to
-- get rid of.
--
-- NOT REQUIRED when an amount is set: a room may publish "unlimited rebuys"
-- and say nothing about when. Forcing a window would leave two bad options —
-- invent one, or drop a fact the room did publish.
-- =====================================================================

create type tournament_offer_window as enum ('first_break', 'through_late_reg');

comment on type tournament_offer_window is
  'When a rebuy or add-on may be taken. through_late_reg = until registration '
  'closes (see late_reg_level); first_break = at the first break only. A third '
  'shape needs a migration, deliberately.';

alter table tournament_templates
  add column rebuy_amount    numeric(10,2),
  add column rebuy_chips     integer,
  add column rebuy_max       integer,
  add column rebuy_unlimited boolean not null default false,
  add column rebuy_max_stack integer,
  add column rebuy_window    tournament_offer_window,
  add column addon_amount    numeric(10,2),
  add column addon_chips     integer,
  add column addon_max       integer,
  add column addon_window    tournament_offer_window;

comment on column tournament_templates.rebuy_amount is
  'Cost of ONE rebuy. NULL = the event has no published rebuy.';
comment on column tournament_templates.rebuy_chips is
  'Chips RECEIVED for a rebuy. NULL = not published — which is the case for '
  'all four Wynn dailies. Never confuse with rebuy_max_stack.';
comment on column tournament_templates.rebuy_max is
  'How many rebuys are allowed. NULL = not published. Unlimited is NOT spelled '
  'NULL — see rebuy_unlimited and the note at the head of this migration.';
comment on column tournament_templates.rebuy_unlimited is
  'The room publishes "unlimited". A positive claim, distinct from an unstated '
  'count, and the reason rebuy_max does not use NULL for it.';
comment on column tournament_templates.rebuy_max_stack is
  'ELIGIBILITY THRESHOLD: a rebuy may be taken only while the stack is at or '
  'below this. Wynn 15,000. This is NOT chips received.';
comment on column tournament_templates.addon_amount is
  'Cost of the add-on. NULL = the event has no published add-on.';
comment on column tournament_templates.addon_chips is
  'Chips received for the add-on. Caesars publishes 15,000; Wynn publishes no '
  'figure, so it is NULL there.';
comment on column tournament_templates.addon_max is
  'How many add-ons. Both rooms publish "one".';

-- ---------------------------------------------------------------------
-- CONSTRAINTS
-- ---------------------------------------------------------------------
-- Every one of these refuses an INCOHERENT row, never an INCOMPLETE one. The
-- standing rule: constraints prevent contradiction, they do not demand
-- completeness. A room that publishes a rebuy price and nothing else is a row
-- this table must accept, because that is a real thing a room does.

-- A detail with no price is a term nobody can act on: "15,000 chips or less"
-- with no amount, "unlimited" with nothing to buy.
alter table tournament_templates add constraint rebuy_details_need_a_price check (
  rebuy_amount is not null
  or (rebuy_chips is null and rebuy_max is null and rebuy_max_stack is null
      and rebuy_window is null and rebuy_unlimited = false)
);

-- Two answers to "how many" is a contradiction, not extra information.
alter table tournament_templates add constraint rebuy_count_is_one_answer check (
  not (rebuy_unlimited and rebuy_max is not null)
);

alter table tournament_templates add constraint addon_details_need_a_price check (
  addon_amount is not null
  or (addon_chips is null and addon_max is null and addon_window is null)
);

-- Money and chips are positive or they are not being published. A $0 rebuy is
-- not a free rebuy, it is a row somebody left half-filled.
alter table tournament_templates add constraint rebuy_amounts_positive check (
  (rebuy_amount is null or rebuy_amount > 0)
  and (rebuy_chips is null or rebuy_chips > 0)
  and (rebuy_max is null or rebuy_max > 0)
  and (rebuy_max_stack is null or rebuy_max_stack > 0)
);
alter table tournament_templates add constraint addon_amounts_positive check (
  (addon_amount is null or addon_amount > 0)
  and (addon_chips is null or addon_chips > 0)
  and (addon_max is null or addon_max > 0)
);

-- ---------------------------------------------------------------------
-- ⚠️ WHAT THE GENERATED COLUMNS MEAN NOW. READ THIS BEFORE SORTING BY THEM.
-- ---------------------------------------------------------------------
-- `total_buy_in` and `fee_percent` are UNCHANGED by this migration, and that is
-- a decision rather than an omission.
--
--   total_buy_in  is the ENTRY. What it costs to sit down, once. It is not
--                 what the event costs, and after this migration there are
--                 rows where those two numbers are very far apart.
--   fee_percent   is the house's share OF THAT ENTRY. It is not the house's
--                 share of what a player will actually spend, because the
--                 split of a rebuy or an add-on is not published by either
--                 room — neither says how much of a $200 rebuy is fee.
--
-- NO TOTAL-COST COLUMN IS ADDED, AND NONE SHOULD BE. Three reasons, in order of
-- how badly each one breaks a total:
--
--   1. UNLIMITED HAS NO MAXIMUM. Wynn's Friday event has no upper bound at all.
--      Any "cost" figure for it is a number somebody chose.
--   2. HOW MANY REBUYS A PLAYER TAKES IS BEHAVIOUR, not a published fact. Even
--      a bounded event's real cost depends on how the player runs.
--   3. THE SPLIT OF A REBUY IS NOT PUBLISHED, so even a maximum could not be
--      broken into prize pool and house — which is the one thing that makes
--      the buy-in columns worth having in the first place.
--
-- A `max_cost = entry + rebuy_max * rebuy_amount + addon_amount` column IS
-- derivable for the bounded events, and it is deliberately not here. It would
-- be read as "the cost", it assumes a player takes everything, and it is
-- undefined for exactly the event that most needs a cost figure. This is the
-- same ruling Just the Facts already carries: where a figure would have to be
-- modelled, the surface shows the components and declines the total.
--
-- So the surfaces show entry, rebuy and add-on as separate published figures,
-- and say plainly that the sum is not ours to state.
comment on column tournament_templates.total_buy_in is
  'THE ENTRY, not the cost of playing. Rebuys and add-ons are separate columns '
  'and are deliberately not summed into this — see migration 014.';
comment on column tournament_templates.fee_percent is
  'The house''s share of the ENTRY. Not of what a player spends: neither room '
  'publishes how a rebuy or add-on is split, so that figure does not exist.';

-- The off-by-one nobody would notice, pinned while this file is open. The
-- documents say "until the START of level 9" and the column holds 9 — so the
-- last level you may register in is 8. Stored as the level registration
-- CLOSES AT, matching the wording of both rooms' documents.
comment on column tournament_templates.late_reg_level is
  'Registration closes at the START of this level, matching both rooms'' '
  'wording. The last level a player may enter in is therefore this minus one.';
