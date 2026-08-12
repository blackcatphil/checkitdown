-- =====================================================================
-- WHAT A BOUNTY IS. 2026-08-12. PROPOSED — not applied to production.
-- =====================================================================
-- ⚠️ THE COLUMN WOULD HAVE PUBLISHED A FALSE PRICE, AND NOTHING WOULD HAVE
-- CAUGHT IT.
--
-- `bounty_amount` has existed since the tournament schema landed and has never
-- held a non-zero value. Bellagio's Saturday/Sunday $200 event is the first real
-- one — "$200 NLH TOURNAMENT WITH $50 BOUNTIES" — and storing 50 in it would
-- have made `total_buy_in` read 230 for an event the room sells for 200.
--
-- The reason is that the generated column ADDS it:
--
--     total_buy_in = entry + fee + coalesce(bounty_amount,0) + coalesce(staff,0)
--
-- which encodes one assumption about what a bounty IS: an extra amount paid on
-- top of the entry, the "$200 + $50" shape. Bellagio's is the other kind. Its
-- rule 7 accounts for every dollar — "$160 of $200 Buy-in goes to the
-- prize-pool, $20 of $200 goes to admin fees" — and rule 8 says the guarantee
-- is "the TOTAL Prize Pool (INCLUDING BOUNTIES)". The $50 is carved OUT of the
-- prize pool, not added to the price. There is no room in $200 for it.
--
-- Both shapes are real and common. A column that cannot tell them apart is not
-- missing a value, it is missing a FACT — so the fact gets a column.
--
-- =====================================================================
-- ⚠️ AND 0 STOPS MEANING "NOBODY CHECKED"
-- =====================================================================
-- `bounty_amount` defaults to 0, so every template in production carries a
-- typed claim that it has no bounty. Nobody ever checked.
--
-- That is the same absence-as-measurement failure `rooms.verified_at` is
-- rendered as an em-dash to avoid, and it has to go before a real 0 can mean
-- anything.
--
-- ⚠️ 42 ROWS, NOT 26. Counted against production rather than taken from the
-- brief: 26 Wynn templates and 16 Orleans ones, every one reading 0.00. The
-- Orleans half is the same invention as the Wynn half and is corrected by the
-- same statement.
--
-- =====================================================================
-- ⚠️ `supabase db reset` CANNOT TEST THIS MIGRATION. IT IS NOT A WEAK TEST
-- HERE, IT IS A STRUCTURALLY BLIND ONE.
-- =====================================================================
-- `db reset` applies every migration to an EMPTY database and loads `seed.sql`
-- AFTERWARDS. So when this file ran locally:
--
--   · the constraint was added against ZERO rows and could not fail
--   · the backfill UPDATE matched ZERO rows and did nothing
--   · the seed then inserted rows that were already correct
--
-- Every statement "passed" without a single one being exercised. The local run
-- was green and production rolled back, and those two outcomes were never in
-- tension — they were answers to different questions.
--
-- ANY MIGRATION THAT BACKFILLS EXISTING DATA IS UNTESTABLE BY RESET, because
-- reset guarantees there is no existing data. The only proof is a scratch
-- database seeded from a PRODUCTION SNAPSHOT before the migration is applied —
-- `scripts/migration-018-gate.mjs`, following the pattern
-- `scripts/migration-017-gate.mjs` established for permissions.
--
-- =====================================================================
-- After this migration the three states are distinct:
--   NULL  nobody has recorded whether this event has a bounty
--   0     somebody looked and it has none          (nothing writes this yet)
--   50    it has a $50 bounty, funded as stated
-- =====================================================================

create type bounty_funding as enum ('added_to_entry', 'from_prize_pool');

comment on type bounty_funding is
  'Where a knockout bounty comes from. added_to_entry: paid on top of the '
  'entry, so it raises the price ("$200 + $50"). from_prize_pool: carved out '
  'of the prize pool, so the price is unchanged — Bellagio''s $200 with $50 '
  'bounties, where rule 7 accounts for all $200 and rule 8 says the guarantee '
  'includes the bounties.';

alter table tournament_templates
  add column bounty_funding bounty_funding;

comment on column tournament_templates.bounty_amount is
  'What a player collects per knockout. Unchanged meaning. NULL means nobody '
  'has checked; 0 means somebody looked and there is none. Whether it raises '
  'the price is bounty_funding''s job, not this column''s.';
comment on column tournament_templates.bounty_funding is
  'Required whenever bounty_amount is present and forbidden when it is absent '
  '— see bounty_is_whole_or_absent. total_buy_in adds the bounty only when '
  'this is added_to_entry.';

-- ---------------------------------------------------------------------
-- THE DEFAULT GOES, AND THE 42 ROWS IT INVENTED GO WITH IT
-- ---------------------------------------------------------------------
alter table tournament_templates alter column bounty_amount drop default;

-- ⚠️ SCOPED TO THE ROWS THE DEFAULT WROTE. `bounty_amount = 0` today can only
-- have come from the default — nothing in the codebase has ever set this column
-- (grep `bounty_amount` across scripts/ returns the schema and nothing else).
-- The day something writes a real 0 it will mean "checked, none", and this
-- statement would wrongly erase it; it is written to run exactly once, against
-- a state where 0 is provably not a measurement.
update tournament_templates set bounty_amount = null where bounty_amount = 0;

-- ⚠️ THE CONSTRAINT COMES LAST, AND THE ORDER IS THE WHOLE BUG.
--
-- This was declared immediately after the column, BEFORE the backfill below it —
-- and it failed on production, because production's 42 rows held bounty_amount
-- 0.00 with bounty_funding NULL at the moment the constraint arrived. Half a
-- bounty fact, on every row, created by the very default this migration removes.
-- The transaction rolled back cleanly and prod was untouched, which is the only
-- part that went right.
--
-- BOTH HALVES OR NEITHER — the same rule migration 015 applies to a buy-in
-- split, for the same reason. An amount with no funding cannot be priced: the
-- generated column would have to guess, and guessing here is the difference
-- between advertising $200 and advertising $250. A funding with no amount is a
-- claim about a bounty nobody has recorded.
alter table tournament_templates add constraint bounty_is_whole_or_absent check (
  (bounty_amount is null) = (bounty_funding is null)
);

-- ---------------------------------------------------------------------
-- THE GENERATED COLUMNS, DROPPED AND RE-ADDED
-- ---------------------------------------------------------------------
-- Postgres cannot ALTER a generation expression, so the columns are dropped and
-- rebuilt. That is safe here for the reason migration 015 gave when it did the
-- same thing: NOTHING NON-DERIVABLE IS STORED IN THEM. Every input —
-- entry_amount, fee_amount, bounty_amount, bounty_funding, staff_amount,
-- published_buy_in — survives the drop untouched, so the values that come back
-- are computed from the same facts. A dropped column here loses no information.
--
-- ⚠️ fee_percent USES THE SAME DENOMINATOR and is rebuilt with it. Leaving it on
-- the old expression would make the fee share disagree with the total it is a
-- share OF — a room's fee percentage computed against a price the site does not
-- show.
alter table tournament_templates drop column total_buy_in;
alter table tournament_templates drop column fee_percent;

alter table tournament_templates
  add column total_buy_in numeric generated always as (
    case when entry_amount is not null and fee_amount is not null
      then entry_amount + fee_amount
         + case when bounty_funding = 'added_to_entry'
                then coalesce(bounty_amount, 0) else 0 end
         + coalesce(staff_amount, 0)
      else published_buy_in
    end
  ) stored;

alter table tournament_templates
  add column fee_percent numeric generated always as (
    case when entry_amount is not null and fee_amount is not null
      then round(100 * fee_amount / nullif(
             entry_amount + fee_amount
           + case when bounty_funding = 'added_to_entry'
                  then coalesce(bounty_amount, 0) else 0 end
           + coalesce(staff_amount, 0), 0), 2)
      else null
    end
  ) stored;

comment on column tournament_templates.total_buy_in is
  'What a player must hand over. Adds the bounty ONLY when it is funded '
  'added_to_entry; a from_prize_pool bounty is already inside the entry and '
  'adding it would advertise a price the room does not charge.';

-- ⚠️ THE CHECK THAT USED THE OLD EXPRESSION MOVES WITH IT. It compared a
-- published price against entry+fee+bounty+staff, so a from_prize_pool bounty
-- would have made a correctly-published price fail the constraint.
alter table tournament_templates drop constraint published_total_matches_split;
alter table tournament_templates add constraint published_total_matches_split check (
  published_buy_in is null
  or entry_amount is null
  or published_buy_in = entry_amount + fee_amount
       + case when bounty_funding = 'added_to_entry'
              then coalesce(bounty_amount, 0) else 0 end
       + coalesce(staff_amount, 0)
);
