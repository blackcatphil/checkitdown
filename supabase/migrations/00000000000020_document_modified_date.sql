-- =====================================================================
-- A THIRD ANSWER TO "WHERE DID THIS DATE COME FROM". 2026-08-12.
-- PROPOSED — not applied to production.
-- =====================================================================
-- ⚠️ THIS IS A MIGRATION BECAUSE `document_date_source` IS AN ALLOWLIST, and
-- that is the point of it. Migration 011 made the provenance of a document's
-- date a stored fact with exactly two permitted answers — `printed` (the room
-- put a date on the page) and `pdf_created` (it did not, so the file's own
-- CreationDate stands). A third case cannot be written without saying so here.
--
-- BELLAGIO IS THE THIRD CASE. Its schedule prints no date and carries no
-- version. The PDF metadata gives two:
--
--   CreationDate  2025-10-06
--   ModDate       2026-01-09
--
-- Three months apart. `pdf_created` would record 2025-10-06 — three months
-- older than the last time anybody touched the file, on a schedule whose whole
-- value is being current. And it would be a FALSE CLAIM ABOUT PROVENANCE, which
-- is worse than being wrong about the date: it would say "the file was made on
-- this day" when what we actually know is "the file was last changed on this
-- day".
--
-- ⚠️ AND `pdf_modified` IS THE WEAKEST OF THE THREE. A ModDate moves when
-- anybody re-saves the file, including for reasons that have nothing to do with
-- the schedule — a metadata edit, a re-export, a compression pass. It is an
-- upper bound on staleness and nothing more: the schedule is no OLDER than this
-- date, and may be unchanged for much longer. It ranks below `printed` for the
-- same reason `pdf_created` does, and the surface should read it as "we do not
-- know when this was written; we know when the file last moved".
--
-- The room publishes no date at all. That fact belongs in the module that reads
-- it, and it is stated there.
alter table tournament_templates drop constraint template_document_date_is_explained;

alter table tournament_templates add constraint template_document_date_is_explained check (
  (document_effective_on is null and document_date_source is null)
  or (document_effective_on is not null
      and document_date_source is not null
      and document_date_source in ('printed', 'pdf_created', 'pdf_modified'))
);

comment on column tournament_templates.document_date_source is
  'Where document_effective_on came from, strongest first. printed: the room '
  'dated the document itself. pdf_created: it did not, so the file''s '
  'CreationDate stands. pdf_modified: the file was changed well after it was '
  'created and the ModDate is the only current signal — an upper bound on '
  'staleness, not a publication date.';
