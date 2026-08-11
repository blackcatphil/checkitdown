-- =====================================================================
-- WHEN A ROOM PUBLISHES A PRICE AND NOT ITS SPLIT. 2026-08-11.
-- =====================================================================
-- Three rooms were read on 2026-08-11 and two of them broke the model this
-- table has carried since the first migration: that a buy-in is ALWAYS
-- entry + fee, both known.
--
--   THE ORLEANS publishes a headline and nothing else. Its August schedule
--   says, in the room's own words, "Consult structure sheets for details on
--   individual events, including starting chips, level duration, blind levels,
--   and ENTRY FEES" — and the structures PDF it defers to is no longer linked
--   from the poker room page. So $150 is the whole of what the room states.
--
--   BELLAGIO publishes a split, and then a wrinkle nothing here could hold: a
--   VOLUNTARY $17 staff gratuity, taken at registration, which grants 10,000
--   extra chips and is not kept by the house. The poster's headline is "$150";
--   the amount a player must pay is $133.
--
-- ⚠️ WHY entry_amount = total AND fee_amount = 0 IS NOT THE ANSWER for the
-- first case, and is the reason this migration exists rather than a one-line
-- insert. It types out to a real row with a real figure: `fee_percent` computes
-- to 0.00, sorts to the top of the FEE % ranking, and tells a reader that The
-- Orleans takes nothing — the most favourable claim available about a room that
-- has published no claim at all. That is the unknown-as-zero failure this whole
-- product exists to refuse, and it would have been our own invention rather
-- than a bad source's.
--
-- So the split becomes optional and its ABSENCE becomes representable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE SPLIT IS NO LONGER MANDATORY
-- ---------------------------------------------------------------------
alter table tournament_templates
  alter column entry_amount drop not null,
  alter column fee_amount   drop not null;

-- The room's own stated price, for the case where that is all there is.
alter table tournament_templates
  add column published_buy_in numeric(10,2);

comment on column tournament_templates.published_buy_in is
  'The room''s stated buy-in when it publishes no split. NULL when entry_amount '
  'and fee_amount are known — the split is the better answer and total_buy_in '
  'is computed from it.';

-- ---------------------------------------------------------------------
-- 2. THE GENERATED COLUMNS ARE REBUILT, NOT ALTERED
-- ---------------------------------------------------------------------
-- Postgres has no ALTER for a generation expression, so both columns are
-- dropped and re-added. That is safe precisely because they are generated:
-- nothing is stored in them that is not derivable from the base columns, so the
-- re-add recomputes every existing row. Verified before writing this: no view,
-- index or constraint depends on either column.
--
-- ⚠️ THEY STAY GENERATED. The obvious alternative — make total_buy_in an
-- ordinary column the caller fills in — was rejected for the reason the
-- original migration gives: this is a RANKED column, and a caller who forgets
-- leaves a NULL that drops silently out of a sort. Generated means it cannot be
-- forgotten, and the CHECK below means it cannot be null.
alter table tournament_templates drop column total_buy_in;
alter table tournament_templates drop column fee_percent;

alter table tournament_templates
  add column total_buy_in numeric(10,2)
    generated always as (
      case when entry_amount is not null and fee_amount is not null
           then entry_amount + fee_amount
                + coalesce(bounty_amount, 0) + coalesce(staff_amount, 0)
           else published_buy_in
      end
    ) stored;

-- ⚠️ NULL WHEN THE SPLIT IS UNKNOWN, and that is the entire point. The old
-- expression divided by the total, so an unknown split with a known total would
-- have produced 0.00 — a figure, in a sortable column, asserting that the room
-- takes nothing. There is deliberately no coalesce and no default here: the
-- absence has to survive all the way to the surface, where it renders as
-- UNKNOWN rather than as a number.
alter table tournament_templates
  add column fee_percent numeric(5,2)
    generated always as (
      case when entry_amount is not null and fee_amount is not null
           then round(
             100 * fee_amount
             / nullif(entry_amount + fee_amount
                      + coalesce(bounty_amount, 0) + coalesce(staff_amount, 0), 0),
             2)
      end
    ) stored;

comment on column tournament_templates.total_buy_in is
  'THE MANDATORY ENTRY, not the cost of playing. Computed from the split where '
  'the room publishes one, and from published_buy_in where it does not. Rebuys, '
  'add-ons and optional gratuities are separate and are never summed into this '
  '— see migrations 014 and 015.';
comment on column tournament_templates.fee_percent is
  'The house''s share of the ENTRY, or NULL when the room publishes no split. '
  'NULL means UNKNOWN and must render as UNKNOWN — never 0, never blank.';

-- ---------------------------------------------------------------------
-- 3. THE SPLIT OR THE TOTAL, NEVER NEITHER
-- ---------------------------------------------------------------------
-- Without this, dropping NOT NULL would let a row exist with no price at all —
-- an event that costs nothing to state. total_buy_in would be NULL and the row
-- would drop out of every buy-in sort silently, which is the same disappearance
-- the generated column was introduced to prevent.
alter table tournament_templates add constraint buy_in_is_stated check (
  (entry_amount is not null and fee_amount is not null)
  or published_buy_in is not null
);

-- BOTH HALVES OF A SPLIT OR NEITHER. Half a split cannot produce a fee share,
-- and a row holding entry without fee would satisfy the constraint above only
-- by also carrying a published total — at which point it is claiming three
-- figures that constrain each other and nothing checks the arithmetic. A room
-- that publishes only a prize-pool contribution is a real future case and is
-- deliberately a migration, not a silent third state.
alter table tournament_templates add constraint split_is_whole_or_absent check (
  (entry_amount is null) = (fee_amount is null)
);

-- WHERE BOTH EXIST THEY AGREE. A room that publishes a headline AND a split
-- gives us two statements about one number; storing both without checking them
-- is how a transcription slip in one of them survives review. Caesars is
-- exactly this shape: "$100" on the poster, "$70 + $30" in the rules.
alter table tournament_templates add constraint published_total_matches_split check (
  published_buy_in is null
  or entry_amount is null
  or published_buy_in = entry_amount + fee_amount
                        + coalesce(bounty_amount, 0) + coalesce(staff_amount, 0)
);

alter table tournament_templates add constraint published_buy_in_positive check (
  published_buy_in is null or published_buy_in > 0
);

-- ---------------------------------------------------------------------
-- 4. THE AT-REGISTRATION OFFER WINDOW
-- ---------------------------------------------------------------------
-- Migration 014 shipped two windows and said a third should cost a migration
-- and a review. This is that migration. Bellagio's gratuity is taken at
-- registration only — before a card is dealt, not at a break and not through
-- late registration — and calling it either of the existing two would misstate
-- when a player can act on it.
alter type tournament_offer_window add value if not exists 'at_registration';

-- ---------------------------------------------------------------------
-- 5. THE ADVERTISED HEADLINE, VERBATIM
-- ---------------------------------------------------------------------
-- RULED 2026-08-11: the buy-in is the MANDATORY amount. Bellagio's poster says
-- "$150 NLH TOURNAMENT"; $17 of that is a voluntary gratuity, so a player must
-- pay $133 and may pay $150. Storing 150 as the buy-in would overstate the
-- price of entry; storing 133 alone would leave a reader unable to reconcile
-- our figure with the sign on the wall.
--
-- So both: total_buy_in is 133, the gratuity is an at-registration add-on with
-- its chips, and THIS is what the room calls it — stored as the room wrote it
-- rather than as a number, because it is a quotation. It is rendered beside our
-- figure, never instead of it, and never summed with anything.
--
-- NOT DERIVED as mandatory + optional. That happens to equal 150 here and is an
-- assumption about how every room words a headline, on a field whose only job
-- is to be what the room actually printed.
alter table tournament_templates
  add column advertised_as text;

comment on column tournament_templates.advertised_as is
  'What the room calls this event''s price on its own poster, verbatim, when '
  'that differs from the mandatory buy-in — e.g. Bellagio''s "$150" against a '
  '$133 mandatory entry plus a voluntary $17 gratuity. A quotation, not a '
  'figure: never parsed, never summed, never sorted.';

alter table tournament_templates add constraint advertised_as_is_not_blank check (
  advertised_as is null or length(btrim(advertised_as)) > 0
);
