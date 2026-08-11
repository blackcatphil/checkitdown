-- =====================================================================
-- A STRUCTURE SHEET'S CONTENT IDENTITY. 2026-08-11.
-- =====================================================================
-- The tournament ingest is re-runnable, and re-runnable has to mean "writes
-- nothing when nothing changed" rather than "rewrites the same 659 rows every
-- night". Without a stored identity the only way to tell is to read every level
-- back and compare, which is both slow and — more importantly — indistinguishable
-- in the change_log from a real replacement. Every run would log a change.
--
-- So each template records the hash of the sheet it was transcribed from. A run
-- whose document is unchanged is a no-op with no log row; a run whose document
-- MOVED replaces that sheet's levels in one transaction and logs exactly one
-- entry saying which sheet and how many levels.
--
-- This is a fact about OUR COPY, not about the room, which is why it is not
-- provenance: source_url says where the sheet came from, fetched_at says when
-- we looked, and this says which version we are holding.
alter table tournament_templates add column structure_hash text;

comment on column tournament_templates.structure_hash is
  'Content hash of the transcribed level rows. Lets a re-run tell "unchanged" '
  'from "replaced" without rewriting rows or logging a change that did not happen.';
