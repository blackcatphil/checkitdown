-- =====================================================================
-- PROD APPLY — 2026-08-08. Restore the web citations on the 08-06
-- corroborated rake rows (Wynn NLH, Venetian, Green Valley Ranch).
--
-- Apply to the hosted `checkitdown` project BEFORE the seed commit lands,
-- same sequencing as 756bf16. Run the whole file as one transaction.
--
-- NO FACT CHANGES AND NO COUNT CHANGES. This moves `rake_source_url` and
-- `rake_fetched_at` back to NULL on fourteen rows, which under the schema's
-- documented rule — read the receipt as coalesce(rake_source_url,
-- source_url) — hands each rake figure's citation back to the Vegas
-- Advantage page it was actually read from.
--
-- WHY: the 08-06 apply repointed these receipts at the SinCityGrinders
-- sheet on what were PURE CORROBORATIONS. A corroboration is a
-- VERIFICATION of a figure, not a RE-SOURCING of it. 1edeb7d (08-07) and
-- d7c1a1a (08-08) both ruled the other way; this brings the legacy rows to
-- the settled convention.
--
-- WHAT DOES NOT MOVE: rake_percent, rake_cap, jackpot_drop, source_url,
-- fetched_at, verified_at, and rake_verified_at — the 08-06 stamps STAY.
-- The partner did stand in those rooms that morning; where the figure is
-- cited does not change that he was there.
--
-- FOURTEEN ROWS, NOT SIXTEEN. Wynn's two PLO rows also cite the sheet for
-- rake and MUST KEEP IT: they were inserted 08-07 with split provenance by
-- design — `source_url` is the long-form review doc (the STAKES) and
-- `rake_source_url` is the sheet (the RAKE), because the doc carries no
-- rake figure. The predicate below excludes them by construction via
-- `source_url not like '%docs.google.com%'`, not by a hardcoded list.
--
-- Expected: UPDATE 14, then the verification block prints one NOTICE and
-- commits. Any other row count raises and rolls the whole thing back.
-- =====================================================================

begin;

update cash_games c
   set rake_source_url = null,
       rake_fetched_at = null
  from rooms r
 where r.id = c.room_id
   and r.slug in ('wynn-encore','venetian','green-valley-ranch')
   and c.rake_source_url = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit'
   and c.source_url not like '%docs.google.com%';

-- Same shape guard as the seed carries, so prod and the seed fail on the
-- same conditions with the same words rather than diverging quietly.
do $$
declare
  n_gvr int; n_ven int; n_wynn int; n_plo int; n_rv int; n_bad int;
begin
  select count(*) into n_gvr from cash_games c join rooms r on r.id = c.room_id
   where r.slug = 'green-valley-ranch'
     and c.rake_source_url is null and c.rake_fetched_at is null
     and c.rake_verified_at = timestamptz '2026-08-06 12:00:00-07'
     and c.rake_percent = 10.00 and c.rake_cap = 5.00 and c.jackpot_drop = 3.00;
  if n_gvr <> 5 then
    raise exception 'green-valley-ranch: expected 5 rows restored at cap 5 / drop 3 / 08-06, got %', n_gvr;
  end if;

  select count(*) into n_ven from cash_games c join rooms r on r.id = c.room_id
   where r.slug = 'venetian'
     and c.rake_source_url is null and c.rake_fetched_at is null
     and c.rake_verified_at = timestamptz '2026-08-06 12:00:00-07'
     and c.rake_percent is null and c.rake_cap = 5.00 and c.jackpot_drop = 2.00;
  if n_ven <> 6 then
    raise exception 'venetian: expected 6 rows restored at cap 5 / drop 2 / 08-06, got %', n_ven;
  end if;

  select count(*) into n_wynn from cash_games c join rooms r on r.id = c.room_id
   where r.slug = 'wynn-encore'
     and c.rake_source_url is null and c.rake_fetched_at is null
     and c.rake_verified_at = timestamptz '2026-08-06 12:00:00-07'
     and c.rake_percent = 10.00 and c.rake_cap = 5.00 and c.jackpot_drop = 0.00;
  if n_wynn <> 3 then
    raise exception 'wynn-encore: expected 3 NLH rows restored at cap 5 / drop 0 / 08-06, got %', n_wynn;
  end if;

  -- The two that must NOT have moved.
  select count(*) into n_plo from cash_games c join rooms r on r.id = c.room_id
   where r.slug = 'wynn-encore'
     and c.source_url like '%docs.google.com/document%'
     and c.rake_source_url = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit'
     and c.rake_fetched_at  = timestamptz '2026-08-07 12:00:00-07'
     and c.rake_verified_at = timestamptz '2026-08-07 12:00:00-07';
  if n_plo <> 2 then
    raise exception
      'wynn-encore PLO: expected 2 rows still citing the sheet for rake, got % — the restore over-reached', n_plo;
  end if;

  -- No verification was lost. 42 before, 42 after.
  select count(*) into n_rv from cash_games where rake_verified_at is not null;
  if n_rv <> 42 then
    raise exception 'rake-verified count moved to % — this cleanup must not change it', n_rv;
  end if;

  -- Scoped to the three cleaned rooms ON PURPOSE. Asked globally, this also
  -- catches Orleans (13) and Santa Fe (4), which are RIGHT to cite the sheet:
  -- 08-06 CORRECTED those figures rather than corroborating them.
  select count(*) into n_bad from cash_games c join rooms r on r.id = c.room_id
   where r.slug in ('wynn-encore','venetian','green-valley-ranch')
     and c.rake_source_url = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit'
     and c.source_url not like '%docs.google.com%';
  if n_bad <> 0 then
    raise exception '% row(s) in the three cleaned rooms still cite the sheet for a figure their own page carries', n_bad;
  end if;

  raise notice 'prod restore OK: 14 receipts returned to their own page (GVR 5, Venetian 6, Wynn NLH 3); Wynn PLO 2 untouched; rake-verified still 42';
end $$;

commit;
