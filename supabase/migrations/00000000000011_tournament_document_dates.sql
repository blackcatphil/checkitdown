-- =====================================================================
-- STALENESS IS A FIRST-CLASS FIELD FOR A SCHEDULE. Phil ruled 2026-08-10.
-- =====================================================================
--
-- A schedule is a claim about what runs TODAY. Every other fact in this
-- database is allowed to be old — a rake from March is still a rake somebody
-- published in March — but a 7 p.m. daily that moved to 6 p.m. is not stale,
-- it is WRONG, and publishing it under a first-party citation is worse than
-- publishing nothing.
--
-- The tables carried `fetched_at` (when WE fetched) and `verified_at` (whether
-- a person stood there). Neither answers "how old is the document itself",
-- which is the question a reader of a schedule actually has. So it gets a
-- column rather than a footnote.
--
-- ⚠️ WHY NOT THE URL'S VERSION STAMP. Wynn serves these from Cloudinary and the
-- URLs carry a version integer — v1752011166 and friends — which decodes to a
-- plausible-looking date. Every one of them is ELEVEN MONTHS EARLIER than the
-- PDF's own creation date: the daily poster is v2025-07-08 in its URL and
-- 2026-06-19 inside the file. Using the stamp would have published a
-- thirteen-month-old staleness claim about a two-month-old document, with a
-- real number and a real source, and nothing would have caught it.
-- The document's own date is what counts, in this order:
--   1. a date PRINTED in the document ("August 17-September 7, 2026")
--   2. failing that, the PDF's own CreationDate
--   3. failing both, NULL — and a NULL here reads as "the room publishes no
--      date", which is itself a fact about the room worth showing.
--
-- NULLABLE ON PURPOSE. Wynn's daily poster prints no date at all; forcing one
-- would mean inventing it, and this schema has spent a lot of effort making
-- invented provenance unrepresentable.
-- =====================================================================

alter table tournament_templates
  add column document_effective_on date,
  add column document_date_source text;

comment on column tournament_templates.document_effective_on is
  'The date the SOURCE DOCUMENT itself carries — not when we fetched it. NULL '
  'means the room publishes a schedule with no date on it, which is a fact '
  'about the room rather than a gap in our checking.';

comment on column tournament_templates.document_date_source is
  'Where document_effective_on came from: printed | pdf_created. Recorded so a '
  'reader of the data can tell a stated date from an inferred one — a PDF '
  'CreationDate is evidence, not a publication date, and the two should not be '
  'silently equal.';

alter table tournament_series
  add column document_effective_on date,
  add column document_date_source text;

comment on column tournament_series.document_effective_on is
  'As tournament_templates.document_effective_on. A series usually prints its '
  'own run of dates, so this is normally `printed`.';

-- A date we cannot explain is a date we should not have stored.
--
-- ⚠️ `... is not null and ... in (...)` — BOTH HALVES, and the first one is not
-- redundant. A CHECK constraint PASSES when it evaluates to NULL, and
-- `NULL in ('printed','pdf_created')` is NULL, not false. Written without the
-- explicit null test the whole expression came out `false OR NULL` = NULL for
-- exactly the row it exists to refuse — a dated row with no stated origin —
-- and the constraint sat there looking correct and enforcing nothing.
-- Caught by the pgTAP case below on its first run, which is the entire reason a
-- constraint gets a test rather than a reading.
alter table tournament_templates
  add constraint template_document_date_is_explained check (
    (document_effective_on is null and document_date_source is null)
    or (document_effective_on is not null
        and document_date_source is not null
        and document_date_source in ('printed', 'pdf_created'))
  );

alter table tournament_series
  add constraint series_document_date_is_explained check (
    (document_effective_on is null and document_date_source is null)
    or (document_effective_on is not null
        and document_date_source is not null
        and document_date_source in ('printed', 'pdf_created'))
  );
