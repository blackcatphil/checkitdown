-- =====================================================================
-- WHEN LEVEL LENGTH IS NOT ONE NUMBER. 2026-08-11.
-- =====================================================================
-- The Orleans' Friday Night Special runs 20-minute levels and then 30-minute
-- levels. `level_minutes` is an integer, so it holds NULL — and a NULL there
-- renders as the em-dash, which on this product means ONE specific thing:
--
--     "nobody has checked this yet"
--
-- That is false. The room publishes the figure, we fetched the document, we
-- read it, and we could not store it. Publishing our own storage limit as a gap
-- in our checking is the same class migration 015 fixed for `fee_percent`, and
-- it is worse here because the fix for that one made this one visible: every
-- Orleans event now reads UNKNOWN for its fee and one of them reads a dash for
-- its levels, and the two absences mean different things while looking equally
-- like our failure.
--
-- ⚠️ WHY NOT MAKE level_minutes A RANGE, OR TWO COLUMNS.
-- Because the next room will not print a range. Bellagio prints "20 min"; Wynn
-- prints "30 minutes per level"; The Orleans prints "20/30"; a room running a
-- turbo could print "15 then 20 from level 9". Every one of those is a schedule
-- a person reads in a second and a schema models badly, and each new shape
-- would be another migration for a field nothing sorts, ranks or compares.
-- `level_minutes` keeps its job — the sortable number, where there IS one — and
-- this holds the rest as words.
--
-- ⚠️ IT IS NOT A SECOND ANSWER TO THE SAME QUESTION. The constraint below
-- forbids holding both: a numeric AND a note would be two statements about one
-- fact where only the numeric is ever rendered, so the note would be a stored
-- claim that no reader can see. Storing something nobody can read is how a
-- wrong figure survives review.
--
-- ⚠️ "VERBATIM" IS DOING PRECISE WORK HERE, so be exact about what this holds.
-- The Orleans schedule does NOT print the sentence "20/30 minutes per level".
-- It prints a table whose column header is "Levels" and whose cell reads
-- "20/30", with every other row in that column holding 20 or 30. So the value
-- stored is the CELL PLUS ITS COLUMN'S UNIT — a faithful reading of the
-- document, not a quotation lifted whole. That distinction matters because the
-- surface renders this string with nothing added: what is in the column is
-- exactly what a reader sees, so anything composed into it is composed once,
-- here, by the ingest that read the table.
-- =====================================================================

alter table tournament_templates
  add column level_length_note text;

comment on column tournament_templates.level_length_note is
  'The room''s published level length where `level_minutes` cannot hold it — '
  'e.g. The Orleans'' "20/30 minutes per level". Rendered verbatim, with nothing '
  'appended, and only ever when level_minutes is NULL. Never parsed, never '
  'sorted: it exists because a dash there would claim we had not looked.';

-- A NOTE IS FOR WHAT THE NUMBER CANNOT HOLD. Both set is incoherent — two
-- answers to one question, of which the surface shows only the numeric — so the
-- note would be invisible and unfalsifiable. Constraints prevent contradiction;
-- they do not demand completeness, and a row with neither is still perfectly
-- legal because plenty of rooms publish no level length at all.
alter table tournament_templates add constraint level_note_only_without_a_number check (
  level_length_note is null or level_minutes is null
);

-- A blank note is not a note. Same rule `advertised_as` carries: a field whose
-- only job is to be rendered verbatim must not render as nothing.
alter table tournament_templates add constraint level_length_note_is_not_blank check (
  level_length_note is null or length(btrim(level_length_note)) > 0
);
