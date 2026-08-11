-- =====================================================================
-- MIXED GAMES AND FLIGHTS. Phil ruled 2026-08-10.
-- =====================================================================
-- The Wynn Signature Series is the first series this database has held, and
-- reading it found two things the model could not say. Not "did not model" —
-- could not represent, which is a different and worse thing, because the
-- workaround in both cases produces a row that looks complete and is wrong.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A LEVEL BELONGS TO A GAME, and a mixed game has two per level.
-- ---------------------------------------------------------------------
-- HORSE and TORSE publish their structures like this:
--
--    1  Limit Games        200   400   400-800
--       Stud Games   100   100   400   400-800
--
-- TWO ROWS FOR LEVEL 1, with different antes and different bring-ins, because
-- the rotation plays a limit game and a stud game at the same level and they
-- are not bet the same way. The old primary key was
-- `(template_id, level_number)`, which makes that UNREPRESENTABLE — not
-- awkward, not lossy, impossible. There is no way to write the second row.
--
-- So the PK gains the game. `game_type` is NOT NULL because a primary-key
-- column cannot be null: a nullable one would fail on the first ordinary
-- hold'em level, which is the overwhelming majority of every sheet.
--
-- THE VOCABULARY DESCRIBES HOW THE LEVEL IS BET, not which poker variant it
-- is. The variant is already on the template; what a level needs to say is
-- which betting structure applies, because that is what differs within one
-- level of a rotation:
--
--   main   — blinds and an ante, no fixed bet sizes. No-limit and pot-limit:
--            NLH, PLO, Big O, 5-Card PLO, the turbos, the satellite. The
--            default, and the shape 16 of the 22 sheets use.
--   limit  — fixed-limit betting. The blinds are nearly incidental and the
--            BET SIZES are the structure. Limit Omaha 8, and the "Limit Games"
--            row of a HORSE/TORSE rotation.
--   stud   — stud-style: an ante and a bring-in rather than blinds, with fixed
--            bets. The "Stud Games" row of a rotation.
alter table tournament_levels
  add column game_type text not null default 'main',
  add column small_bet integer,
  add column big_bet   integer;

alter table tournament_levels
  add constraint level_game_type_known check (game_type in ('main', 'limit', 'stud'));

alter table tournament_levels drop constraint tournament_levels_pkey;
alter table tournament_levels add primary key (template_id, level_number, game_type);

comment on column tournament_levels.game_type is
  'How this level is BET, not which variant is played — the variant is on the '
  'template. Part of the primary key because a mixed game genuinely has two '
  'rows for one level, which the old key made impossible to write.';

-- ---------------------------------------------------------------------
-- 2. THE BET SIZES ARE THE STRUCTURE OF A LIMIT GAME.
-- ---------------------------------------------------------------------
-- A limit level that stores 200/400 and drops "400-800" looks complete and
-- describes a different game. Enforced rather than remembered.
--
-- `game_type` is NOT NULL, so `game_type <> 'limit'` can never evaluate to
-- NULL and this constraint cannot pass by three-valued logic the way
-- migration 011's first draft did.
alter table tournament_levels
  add constraint limit_levels_state_their_bets check (
    game_type not in ('limit', 'stud')
    or (small_bet is not null and big_bet is not null)
  );

-- A bet spread that goes backwards is a transcription error, not a structure.
alter table tournament_levels
  add constraint bets_ordered check (
    small_bet is null or big_bet is null or small_bet <= big_bet
  );

comment on column tournament_levels.small_bet is
  'The lower fixed bet — the 400 of "400-800". NULL for main (no-limit and '
  'pot-limit) levels, which have no fixed bet.';

-- ---------------------------------------------------------------------
-- 3. A CONTINUATION IS NOT AN ENTRY POINT.
-- ---------------------------------------------------------------------
-- Six rows of this series read "NO LIMIT HOLD'EM DAY 2" with no buy-in, no
-- chips and no levels: you are already in. Stored as ordinary instances they
-- are indistinguishable from the flights that started the event, and a reader
-- looking at NLH $400 running 17, 18 and 19 August would reasonably conclude
-- they can buy in on the 19th. They cannot. That is a live falsehood published
-- under a first-party citation, which is the exact failure this product exists
-- not to commit.
--
--   entry        — a normal one-off: buy in, play it out.
--   flight       — a starting Day 1 of a multi-flight event. Takes entries.
--   continuation — a Day 2 or later. Takes NO entries.
alter table tournament_instances
  add column entry_kind text not null default 'entry';

alter table tournament_instances
  add constraint instance_entry_kind_known
    check (entry_kind in ('entry', 'flight', 'continuation'));

-- THE RULE IS A COLUMN, NOT A COMMENT. A CHECK on this table cannot reach the
-- template's entry_amount — a CHECK may not subquery — so "a continuation
-- takes no buy-in" is enforced by DERIVING it here instead of leaving every
-- reader to re-derive it correctly. Generated and stored, so a caller cannot
-- forget it and a query can filter on it; the surface reads this column rather
-- than re-implementing the rule in TSX.
alter table tournament_instances
  add column takes_entry boolean
    generated always as (entry_kind <> 'continuation') stored;

comment on column tournament_instances.entry_kind is
  'entry | flight | continuation. A continuation (Day 2) takes no buy-in — see '
  'takes_entry, which derives that rather than trusting each caller to know it.';
