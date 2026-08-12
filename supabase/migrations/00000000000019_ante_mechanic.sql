-- =====================================================================
-- WHAT AN ANTE IS. 2026-08-12. PROPOSED — not applied to production.
-- =====================================================================
-- ⚠️ THE SAME NUMBER MEANS TWO THINGS THAT DIFFER BY THE SIZE OF THE TABLE.
--
-- `tournament_levels.ante` holds a number and nothing else. At an 8-handed
-- table, `ante = 1000` means:
--
--   BIG BLIND ANTE   the big blind posts it, once      →  1,000 a hand
--   TABLE ANTE       every player posts it             →  8,000 a hand
--
-- Eight times the cost, stored identically. That is a bigger distortion than
-- omitting the ante would be, and it is the small_bet/big_bet argument again: a
-- level rendered as `1000-1000` with its 1000 ante dropped describes a game
-- costing 2,000 a hand instead of 3,000, and a level rendered with an ante whose
-- mechanic is unknown describes one of two games eight-fold apart.
--
-- =====================================================================
-- ⚠️ A BELIEF THAT TURNED OUT TO BE WRONG, AND WHY THE COLUMN IS PER-LEVEL
-- =====================================================================
-- The Phase 1 report said Wynn's antes were table antes and Bellagio's and
-- Caesars' were big-blind antes. That was asserted, not checked. WYNN'S OWN
-- DOCUMENT SAYS THE OPPOSITE, rule 6 of the Signature Series structures:
--
--   "All Events will utilize the Big Blind Ante format unless otherwise noted
--    on the Tournament structure sheet. In the event that the player in the big
--    blind has less than the required amount to post both the big blind and the
--    ante, the big blind will be posted first."
--
-- So all three rooms are big-blind-ante rooms, and a per-TEMPLATE flag looked
-- sufficient. It is not, because of the four words at the end of that sentence.
-- Counted across the 659 stored Wynn levels:
--
--   game_type   levels   ante pattern                    mechanic
--   main          439    ante = big_blind, every row      big blind ante
--   limit         140    ante = 0, every row              none
--   stud           80    ante <> 0 and <> big_blind       table ante
--
-- A HORSE or TORSE template holds BOTH limit rounds and stud rounds. One
-- template, two mechanics — so the fact belongs to the LEVEL. A per-template
-- column would have had to pick one and be wrong about the other eighty rows.
--
-- (Stud is also why `ante <> big_blind` there is not an anomaly: for a stud
-- level `wynn.py` stores the BRING-IN in small_blind and the COMPLETION in
-- big_blind. Stud has no blinds to ante from, which is what "otherwise noted"
-- means in practice.)
--
-- =====================================================================
-- AN ENUM, NOT A BOOLEAN
-- =====================================================================
-- `ante_from_big_blind boolean` reads well until a level has no ante at all,
-- which is 140 of the 659 rows here. `false` would claim a table ante of zero,
-- which is a different statement from "this level has no ante", and NULL would
-- have to carry "not applicable" while ALSO being the only way to say "nobody
-- recorded it". That is the one distinction this schema spends the most effort
-- keeping: three states, and a nullable boolean has room for two.
--
-- So: three named states, and NULL still means nobody checked.
create type ante_mechanic as enum ('none', 'big_blind', 'table');

comment on type ante_mechanic is
  'Who posts the ante on a level. none: no ante. big_blind: the big blind '
  'posts it once (Wynn rule 6, Bellagio rule 3, Caesars'' BB Ante column). '
  'table: every player posts it, so the per-hand cost is multiplied by the '
  'number of seats — Wynn''s stud rounds. NULL means nobody has recorded it.';

alter table tournament_levels add column ante_mechanic ante_mechanic;

comment on column tournament_levels.ante is
  'The ante figure as printed. Meaningless without ante_mechanic: the same '
  'number is one bet a hand under big_blind and one per seat under table.';

-- ---------------------------------------------------------------------
-- BACKFILL FROM WHAT THE DOCUMENTS SAY, NOT FROM A DEFAULT
-- ---------------------------------------------------------------------
-- ⚠️ NO `DEFAULT` AND NO BLANKET UPDATE. A default would write the same claim
-- onto every future level regardless of what its room prints, which is the
-- mistake migration 018 is simultaneously undoing for bounty_amount. Each of
-- the three statements below is evidenced:
--
--   limit rows   ante is 0 on all 140 — the sheets print no ante column value
--   main rows    ante = big_blind on all 439, and Wynn rule 6 names the format
--   stud rows    ante <> big_blind on all 80, and stud is posted by every
--                player by the nature of the game
--
-- The WHERE clauses re-assert those patterns rather than trusting game_type
-- alone, so a row that does not match its game's pattern is left NULL — unknown
-- rather than assumed.
update tournament_levels set ante_mechanic = 'none'
 where ante = 0;

update tournament_levels set ante_mechanic = 'big_blind'
 where ante <> 0 and ante = big_blind;

update tournament_levels set ante_mechanic = 'table'
 where ante <> 0 and ante <> big_blind and game_type = 'stud';

-- ⚠️ HALF AN ANTE FACT IS NOT AN ANTE FACT — the same rule 018 applies to a
-- bounty and 015 applies to a split. A figure with no mechanic cannot be
-- priced; a mechanic with no figure is a claim about an ante nobody recorded.
-- `none` is the one pairing where the figure is allowed to be 0, because that
-- IS the figure.
alter table tournament_levels add constraint ante_is_whole_or_absent check (
  (ante is null) = (ante_mechanic is null)
  and (ante_mechanic <> 'none' or ante = 0)
  and (ante_mechanic = 'none' or ante is null or ante > 0)
);
