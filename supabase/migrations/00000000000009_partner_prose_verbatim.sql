-- =====================================================================
-- PARTNER PROSE IS QUOTED MATERIAL. Phil ruled 2026-08-09.
-- =====================================================================
--
-- ⚠️ THIS WEAKENS A CONSTRAINT, AND THAT IS DELIBERATE. A future reader will
-- see `description_states_no_currency` narrowed and reasonably suspect somebody
-- hit the rule and moved it. They did not. The rule was always about ONE of the
-- two kinds of description, and it was written before the other kind existed.
--
-- WHAT THE RULE IS FOR. A Check It Down description is a MAINTAINED FACT: we
-- write it, we own it, and it has to stay true as the data moves underneath it.
-- A paragraph reading "they spread $1/2 and $2/5" keeps saying so for a year
-- after the room drops $1/2, and no gate that reads code will ever see it. That
-- is what the tokens are for — {stakes_lowest} resolves from the same query the
-- facts grid reads, so an approved change moves the paragraph in the same
-- breath as the grid. Nothing about that reasoning has changed, and it still
-- binds every description we author.
--
-- WHY IT CANNOT BIND A PARTNER REVIEW. A partner review is QUOTED MATERIAL, not
-- a maintained fact. It is Chris's writing, published under his eye, and
-- tokenising it EDITS AN AUTHOR: replacing "$5 minimum limp" with a token that
-- resolves from our database means the sentence he wrote is no longer the
-- sentence a reader sees, and it would silently change under him as our data
-- moved. Stripping the figures instead is worse — it removes what he actually
-- observed and leaves prose that reads like it was always vague.
--
-- So partner prose keeps its figures VERBATIM. The staleness is carried where
-- it has always been carried for quoted material: by the visible written-on
-- date beside it. That is the same answer item 4 of the descriptions ruling
-- gave for "recently relocated" — a sentence that dates itself is answered with
-- a date, not with a ban.
--
-- THE CONSTRAINT IS NARROWED, NOT DROPPED. A `checkitdown` description with a
-- typed figure is still unrepresentable, which is the case the rule was written
-- for and the only case it was ever true of.
-- =====================================================================

alter table room_descriptions
  drop constraint description_states_no_currency;

alter table room_descriptions
  add constraint description_states_no_currency check (
    author_kind <> 'checkitdown' or body !~ '\$[0-9]'
  );

comment on constraint description_states_no_currency on room_descriptions is
  'OUR descriptions may not type a figure — they interpolate tokens so they stay '
  'true as the data moves. A partner review is quoted material and keeps its '
  'figures verbatim; its written_at carries the staleness.';

-- ---------------------------------------------------------------------
-- written_at IS FIRST-SEEN. It is NOT the day the author wrote it.
-- ---------------------------------------------------------------------
-- The long-form reviews document carries no date: no Last-Modified header that
-- means anything (Google serves the fetch time), and no date in the body.
-- Verified before this was written, rather than assumed.
--
-- So no authored date exists to store, and none will be invented — a plausible
-- date on a provenance column is the same failure class as a plausible source
-- URL. What is stored instead is the day the differ FIRST SAW THIS TEXT, and
-- the column comment says so in the database itself so the meaning travels with
-- the data rather than living only in this file.
--
-- IT MOVES WHEN THE TEXT MOVES. If Chris rewrites a review, the differ sees new
-- text and stamps the day it saw it. That makes the date answer the question a
-- reader actually has — "how old is this take?" — with an upper bound we can
-- defend, rather than with a guess we cannot. It reads EARLIER than the truth
-- for a review written long before we first fetched it, and it never reads
-- later, which is the safe direction for a staleness signal.
comment on column room_descriptions.written_at is
  'FIRST-SEEN, not authored: the day this exact text was first observed in the '
  'source document. Moves when the text changes. The partner reviews carry no '
  'authored date and none is invented.';
