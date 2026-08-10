-- =====================================================================
-- jackpot_drop IS PART OF THE RAKE, AND THE DATABASE DID NOT KNOW IT.
-- Found by applying it to production, 2026-08-10.
-- =====================================================================
--
-- Three separate places asked "is this a rake field?" with `field like 'rake%'`.
-- Four of the five rake columns are named rake_something and match it. The
-- fifth is `jackpot_drop`, and it does not.
--
-- WHAT THAT COST, OBSERVED RATHER THAN IMAGINED. The first real differ run
-- applied `jackpot_drop: null -> 0` to two Caesars Palace rows. Every one of the
-- three tests took the wrong branch:
--
--   1. THE RECEIPT WENT TO THE WRONG COLUMN. The move fell through to the
--      `else`, which writes the ROW's `source_url` — so both rows stopped citing
--      the Vegas Advantage page that states their stakes and started citing the
--      partner floor sheet, which does not mention stakes at all. The values
--      were right and the receipt was a lie about where they came from: the
--      Westgate misattribution class, produced by the pipeline built to prevent
--      it. Repaired by hand on prod the same minute it was found.
--   2. THE VERIFICATION STAMP CHECKED WAS `verified_at`, the row's stakes stamp,
--      instead of `rake_verified_at`. A drop change would have cleared the wrong
--      stamp, or been gated on the wrong one.
--   3. PRECEDENCE WAS EVALUATED AGAINST THE WRONG FACT. `fact_source_kind` ranks
--      a rake write against the rake's citation; for jackpot_drop it ranked
--      against the row's. A web drop change onto a floor-verified rake would
--      have been allowed if the row's stakes happened to be web-sourced.
--
-- None of this was reachable until something wrote jackpot_drop on its own.
-- Every earlier apply moved it alongside rake_cap, where the group made the
-- rake_cap member take the right branch and the drop rode along.
--
-- THE FIX IS ONE PREDICATE, NAMED ONCE. A pattern match on a column name is a
-- guess about a naming convention, and this schema's rake columns do not all
-- follow one. An explicit list cannot drift from itself, and the next rake
-- column added has exactly one place to be declared.
-- =====================================================================

create or replace function public.is_rake_field(p_field text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  -- THE RAKE FACT FAMILY ON cash_games, enumerated. `jackpot_drop` is the
  -- member whose name breaks the pattern; it is the reason this exists.
  select p_field in (
    'rake_type', 'rake_percent', 'rake_cap', 'jackpot_drop',
    'rake_source_url', 'rake_fetched_at', 'rake_verified_at'
  )
$$;

comment on function public.is_rake_field(text) is
  'Is this column part of the rake fact family? Enumerated rather than matched '
  'on a rake_ prefix, because jackpot_drop is a rake field and does not have one.';

revoke all on function public.is_rake_field(text) from public;

-- ---------------------------------------------------------------------
-- fact_source_kind: rank a drop change against the RAKE's citation.
-- ---------------------------------------------------------------------
create or replace function public.fact_source_kind(
  p_table text,
  p_id    uuid,
  p_field text
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_rake  boolean := (p_table = 'cash_games' and public.is_rake_field(p_field));
  v_verified timestamptz;
  v_url      text;
begin
  if p_table = 'cash_games' and v_is_rake then
    select rake_verified_at, rake_source_url into v_verified, v_url
      from public.cash_games where id = p_id;
    if v_url is null then
      select source_url into v_url from public.cash_games where id = p_id;
    end if;
  elsif p_table = 'cash_games' then
    select verified_at, source_url into v_verified, v_url
      from public.cash_games where id = p_id;
  elsif p_table = 'rooms' then
    select verified_at, source_url into v_verified, v_url
      from public.rooms where id = p_id;
  elsif p_table = 'room_amenities' then
    select verified_at, source_url into v_verified, v_url
      from public.room_amenities where id = p_id;
  elsif p_table = 'room_descriptions' then
    select verified_at, source_url into v_verified, v_url
      from public.room_descriptions where id = p_id;
  else
    raise exception 'fact_source_kind does not know table %', p_table
      using errcode = '22023';
  end if;

  if v_verified is not null then return 'floor'; end if;
  return public.source_kind_of(v_url, null);
end $$;

revoke all on function public.fact_source_kind(text, uuid, text) from public;

-- ---------------------------------------------------------------------
-- approve_change: the stamp column and the receipt move, both corrected.
-- Redefined in full rather than patched — a migration is a record.
-- ---------------------------------------------------------------------
create or replace function public.approve_change(
  p_id uuid,
  p_override_verified boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pc             public.pending_changes;
  v_coltype      text;
  v_slug         text;
  v_verified     timestamptz;
  v_verified_col text;
  v_reviewer     text := nullif(auth.jwt() ->> 'email', '');
  v_is_floor     boolean;
  v_is_insert    boolean;
  v_refusal      text;
  v_key          text;
  v_cols         text;
  v_vals         text;
  v_new_id       uuid;
  v_writes_stamp boolean;
  v_target_kind   text;
  v_incoming_kind text;
begin
  if not (public.is_admin() or public.is_service_caller()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into pc from public.pending_changes where id = p_id for update;
  if not found then
    raise exception 'no such pending change: %', p_id using errcode = 'P0002';
  end if;
  if pc.state <> 'pending' then
    raise exception 'change % is already %', p_id, pc.state using errcode = '22023';
  end if;

  if pc.target_table not in ('rooms', 'cash_games', 'room_amenities', 'room_descriptions') then
    raise exception 'target table % is not applicable through this path', pc.target_table
      using errcode = '22023';
  end if;

  -- 'delete' is a legal change_op and is NOT implemented here. Refused rather
  -- than falling through to the update branch, which would report success
  -- having done nothing.
  if pc.operation not in ('insert', 'update') then
    raise exception 'operation % is not applicable through this path', pc.operation
      using errcode = '22023';
  end if;
  v_is_insert := (pc.operation = 'insert');

  -- ===================================================================
  -- THE FLOOR-STAMP GATE. Read HERE, from `sources`, inside the definer.
  -- ===================================================================
  -- A verification stamp means a person stood in the room. The only thing that
  -- can establish that is the document the proposal cites, so the test is a
  -- join against `sources.data_type` — NOT a parameter, NOT a flag in the
  -- payload, NOT the caller's word. Both of those would let the writer of a
  -- proposal certify their own proposal, which is the whole failure this
  -- function exists to prevent.
  --
  -- A proposal citing no source at all is not floor data: coalesce to false, so
  -- the absence of a receipt refuses rather than defaults open.
  select (s.data_type = 'floor') into v_is_floor
    from public.sources s where s.id = pc.source_id;
  v_is_floor := coalesce(v_is_floor, false);

  -- THE TARGET ROW MUST BELONG TO THE ROOM THE PROPOSAL NAMES.
  -- A valid foreign key pointing at the wrong document is the Westgate
  -- provenance bug in the write path: one room's fact updated, another room's
  -- log entry written, a third page revalidated — every artefact internally
  -- consistent and collectively wrong. room_amenities joins this rule now that
  -- it has an id to be wrong about.
  if pc.room_id is null then
    raise exception 'a proposal must name the room it belongs to' using errcode = '22023';
  end if;

  if v_is_insert then
    if pc.target_id is not null then
      raise exception 'an insert proposal must not name a target row' using errcode = '22023';
    end if;
    if jsonb_typeof(pc.new_value) is distinct from 'object' then
      raise exception 'an insert proposal needs a full-row object in new_value, got %',
        coalesce(jsonb_typeof(pc.new_value), 'null') using errcode = '22023';
    end if;
    -- A ROOM CANNOT BE CREATED THROUGH A PROPOSAL. The roster of 17 is a locked
    -- decision, and structurally an insert into `rooms` has no room to belong
    -- to — the ownership check above would have nothing to check against.
    if pc.target_table = 'rooms' then
      raise exception 'a room cannot be created through a proposal: the roster is a locked decision'
        using errcode = '22023';
    end if;
    if not exists (select 1 from public.rooms r where r.id = pc.room_id) then
      raise exception 'proposal names room %, which does not exist', pc.room_id using errcode = '22023';
    end if;
    -- A ROW MAY NOT BE BORN WITHOUT A CITATION. The seeding rule has held for
    -- every row in this database since the first research pass — "every row
    -- carries source_url and fetched_at" — and an insert path that can create
    -- an uncited row would be the first exception, arriving through the door
    -- built to make provenance stricter.
    --
    -- Note this was never a hard failure waiting to happen: source_url is
    -- NULLABLE on all three target tables, so before this check an uncited
    -- insert would have succeeded SILENTLY and produced a fact with no
    -- receipt — the quiet version of the bug, which is the worse one.
    if pc.source_url is null then
      raise exception 'insert proposal % cites no source_url; a row cannot be created without a citation'
        , p_id using errcode = '22023';
    end if;
  else
    if pc.field is null then
      raise exception 'a field is required to apply an update' using errcode = '22023';
    end if;
    if pc.target_table = 'rooms' then
      if pc.target_id is distinct from pc.room_id then
        raise exception 'proposal targets room % but names room %', pc.target_id, pc.room_id
          using errcode = '22023';
      end if;
    elsif pc.target_table = 'cash_games' then
      if not exists (
        select 1 from public.cash_games cg
         where cg.id = pc.target_id and cg.room_id = pc.room_id
      ) then
        raise exception 'target row % does not belong to room %', pc.target_id, pc.room_id
          using errcode = '22023';
      end if;
    elsif pc.target_table = 'room_amenities' then
      if not exists (
        select 1 from public.room_amenities ra
         where ra.id = pc.target_id and ra.room_id = pc.room_id
      ) then
        raise exception 'target row % does not belong to room %', pc.target_id, pc.room_id
          using errcode = '22023';
      end if;
    -- ROOM_DESCRIPTIONS GETS ITS OWN BRANCH, and the branch above stops being
    -- an `else`. That `else` was correct while room_amenities was the last
    -- table in the allowlist, and became a live bug the moment a fourth one was
    -- added: a description proposal would fall through, be checked for
    -- ownership against room_amenities where its target_id does not exist, and
    -- be refused as "target row does not belong to room" — a true-sounding
    -- message about entirely the wrong table. Naming every branch means the
    -- NEXT table added to the allowlist raises `unhandled` instead of a
    -- plausible lie.
    elsif pc.target_table = 'room_descriptions' then
      if not exists (
        select 1 from public.room_descriptions d
         where d.id = pc.target_id and d.room_id = pc.room_id
      ) then
        raise exception 'target row % does not belong to room %', pc.target_id, pc.room_id
          using errcode = '22023';
      end if;
    else
      raise exception 'target table % reached the ownership check unhandled', pc.target_table
        using errcode = '22023';
    end if;
  end if;

  -- ===================================================================
  -- INSERT
  -- ===================================================================
  if v_is_insert then
    -- room_id AND THE CITATION are forced from the proposal, never read from
    -- the payload. The new row is born citing the document the proposal cites,
    -- which is the insert-side of "the receipt follows the fact" — there is no
    -- prior citation to move, so it is written at birth instead.
    v_cols := 'room_id, source_url, fetched_at';
    v_vals := format('%L::uuid, %L::text, %L::timestamptz',
                     pc.room_id, pc.source_url, pc.fetched_at);

    for v_key in select jsonb_object_keys(pc.new_value) loop
      v_refusal := public.proposal_field_refusal(pc.target_table, v_key, v_is_floor, true);
      if v_refusal is not null then
        raise exception '%', v_refusal using errcode = '42501';
      end if;

      select format_type(a.atttypid, a.atttypmod) into v_coltype
        from pg_attribute a
       where a.attrelid = format('public.%I', pc.target_table)::regclass
         and a.attname = v_key
         and a.attnum > 0
         and not a.attisdropped;
      if v_coltype is null then
        raise exception '% has no column %', pc.target_table, v_key using errcode = '42703';
      end if;

      v_cols := v_cols || format(', %I', v_key);
      v_vals := v_vals || format(', (($1 -> %L) #>> ''{}'')::%s', v_key, v_coltype);
    end loop;

    execute format('insert into public.%I (%s) values (%s) returning id',
                   pc.target_table, v_cols, v_vals)
      into v_new_id using pc.new_value;

    insert into public.change_log (
      target_table, target_id, room_id, operation, field,
      old_value, new_value, source_id, source_url, agent, applied_by
    ) values (
      pc.target_table, v_new_id, pc.room_id, pc.operation, null,
      null, pc.new_value, pc.source_id, pc.source_url, pc.agent, v_reviewer
    );

    update public.pending_changes
       set state = 'approved', reviewed_at = now(), reviewed_by = v_reviewer
     where id = p_id;

    select slug into v_slug from public.rooms where id = pc.room_id;

    return jsonb_build_object(
      'id', p_id,
      'slug', v_slug,
      'operation', 'insert',
      'created_id', v_new_id,
      'overrode_verified', false,
      'verified_was', null
    );
  end if;

  -- ===================================================================
  -- UPDATE
  -- ===================================================================
  v_refusal := public.proposal_field_refusal(pc.target_table, pc.field, v_is_floor, false);
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = '42501';
  end if;

  select format_type(a.atttypid, a.atttypmod) into v_coltype
    from pg_attribute a
   where a.attrelid = format('public.%I', pc.target_table)::regclass
     and a.attname = pc.field
     and a.attnum > 0
     and not a.attisdropped;
  if v_coltype is null then
    raise exception '% has no column %', pc.target_table, pc.field using errcode = '42703';
  end if;

  -- Does this proposal write a stamp, or a fact? Everything below forks on it.
  v_writes_stamp := pc.field in ('verified_at', 'rake_verified_at');

  -- A FACT MAY NOT CHANGE WITHOUT A CITATION FOR THE NEW VALUE. Checked before
  -- anything is written, so the refusal costs no mutation.
  --
  -- Symmetric with the insert rule below, and for the same reason: the receipt
  -- move would otherwise set the citation to NULL, trading a receipt that
  -- CONTRADICTS the value for no receipt at all. Both are wrong; a proposal
  -- that cannot say where its number came from is not a proposal.
  --
  -- A stamp-only proposal is exempt because it moves no receipt — it says a
  -- person confirmed what is already cited, which is a corroboration.
  if not v_writes_stamp and pc.source_url is null then
    raise exception 'proposal % changes % but cites no source_url; a fact cannot change without a citation for the new value',
      p_id, pc.field using errcode = '22023';
  end if;

  -- IS THE FACT BEING CHANGED PERSON-VERIFIED? Rake carries its own stamp, so
  -- the answer depends on which field is being replaced, not just which row.
  v_verified_col := case
    when pc.target_table = 'cash_games' and public.is_rake_field(pc.field) then 'rake_verified_at'
    else 'verified_at'
  end;
  execute format('select %I from public.%I where id = $1', v_verified_col, pc.target_table)
    into v_verified using pc.target_id;

  -- ===================================================================
  -- THE PRECEDENCE LAW (Phil ruled 2026-08-09). Replaces the approval gate.
  -- ===================================================================
  -- What stood here was a HUMAN-APPROVAL rule: any write onto a person-verified
  -- fact was refused until someone passed an override flag. That made a person
  -- the gate, which is why every routine partner update needed a human in the
  -- loop to say yes to data that was never in doubt.
  --
  -- The law is now PRECEDENCE, not permission:
  --
  --     floor -> web         APPLY    a visit outranks a page
  --     floor -> unsourced   APPLY
  --     floor -> floor       REFUSE unless p_override_verified — the override's
  --                                    ONLY remaining meaning: this newer floor
  --                                    document supersedes the older one
  --                                    (South Point today)
  --     web   -> web         APPLY
  --     web   -> unsourced   APPLY
  --     web   -> floor       REFUSE, AND THE OVERRIDE CANNOT LIFT IT
  --
  -- THE LAST LINE IS THE WHOLE POINT. If a flag could let web win over floor,
  -- this would be permission wearing precedence's clothes — the rule would hold
  -- exactly until someone was in a hurry. So the override is not consulted on
  -- that branch at all, and there is no queue, no flag and no "review this"
  -- state: the write is declined, named, and counted by the caller.
  --
  -- WHY verified_at COUNTS AS FLOOR PROVENANCE. A stamp means a person stood in
  -- the room. South Point is person-verified while still citing Vegas Advantage
  -- — a corroboration keeps the original citation — so reading the citation
  -- alone would classify that fact as web and let a web write overwrite a fact
  -- somebody physically confirmed. The stamp is therefore floor evidence in its
  -- own right; see fact_source_kind().
  v_target_kind := public.fact_source_kind(pc.target_table, pc.target_id, pc.field);
  v_incoming_kind := case when v_is_floor then 'floor' else 'web' end;

  if v_target_kind = 'floor' then
    if not v_is_floor then
      raise exception
        'precedence: a % source may not overwrite a floor-sourced fact (%.% on row %). Floor always trumps web.',
        v_incoming_kind, pc.target_table, pc.field, pc.target_id
        using errcode = 'CID03';
    end if;
    if not p_override_verified then
      raise exception
        'precedence: floor onto floor needs p_override_verified — say that this document supersedes the earlier visit (%.% on row %)',
        pc.target_table, pc.field, pc.target_id
        using errcode = 'CID03';
    end if;
  end if;

  execute format('update public.%I set %I = ($1 #>> ''{}'')::%s where id = $2',
                 pc.target_table, pc.field, v_coltype)
    using pc.new_value, pc.target_id;

  -- ===================================================================
  -- THE RECEIPT FOLLOWS THE FACT.
  -- ===================================================================
  -- Without this, approval wrote a new value and left the OLD citation sitting
  -- next to it — so the first queued floor correction would produce a row whose
  -- source_url points at a page that says something different. That is the
  -- Westgate misattribution class landing in the write path on day one: the
  -- figure, its receipt and the page all internally readable, and collectively
  -- a lie about where the number came from.
  --
  -- WHICH RECEIPT MOVES IS THE FACT-FAMILY, NOT THE ROW. Rake carries its own
  -- receipt on cash_games, so a rake correction moves rake_source_url and
  -- leaves the row's stakes citation alone — the split that let Orleans cite
  -- Boyd for its stakes and Vegas Advantage for its cap.
  --
  -- AND IT MOVES ONLY WHEN A VALUE MOVED. A stamp-only proposal — the partner
  -- confirming a figure we already hold — changes no number, so it re-sources
  -- nothing. That is the corroboration-versus-correction rule from 4a55228,
  -- and it is the reason this is gated on v_writes_stamp rather than run
  -- unconditionally: South Point kept its Vegas Advantage citation through a
  -- floor verification, and this path has to reach the same answer.
  --
  -- The values come from pc.source_url / pc.fetched_at — the proposal's own
  -- metadata, which the detector sets and a human reviewer can read in the
  -- queue. They are NOT read from new_value: the payload cannot carry a
  -- citation at all (see proposal_field_refusal), so there is no path by which
  -- provenance sneaks in through the door this opens.
  if not v_writes_stamp then
    if pc.target_table = 'cash_games' and public.is_rake_field(pc.field) then
      update public.cash_games
         set rake_source_url = pc.source_url, rake_fetched_at = pc.fetched_at
       where id = pc.target_id;
    else
      execute format('update public.%I set source_url = $1, fetched_at = $2 where id = $3',
                     pc.target_table)
        using pc.source_url, pc.fetched_at, pc.target_id;
    end if;
  end if;

  -- A VALUE A PERSON HAS NOT SEEN IS NOT PERSON-VERIFIED. Overriding keeps the
  -- floor visit in the log but drops the claim from the row.
  --
  -- UNLESS THE PROPOSAL *IS* THE STAMP. A floor-sourced proposal writing
  -- verified_at would otherwise have the value it just wrote wiped on the next
  -- statement — the clear-after-override reading the same column it had just
  -- set. That is the one case where the stamp survives, because a person did
  -- stand there and the proposal is the record of it.
  -- UNDER PRECEDENCE THIS TURNS ON WHO IS WRITING, not on who approved.
  -- A WEB write clears the stamp: nobody saw the new number, so the claim that
  -- a person did must go. A FLOOR write keeps it, because a floor document IS a
  -- person having stood there — clearing it would throw away a true fact to
  -- satisfy a rule that no longer applies.
  --
  -- THE RESIDUAL IMPRECISION, STATED RATHER THAN HIDDEN: a kept stamp still
  -- carries the EARLIER visit's date, so after a floor correction the date
  -- refers to the visit that established the fact family rather than the one
  -- that changed this figure. Moving it is a stamp write, which is a proposal
  -- in its own right — pair the two in approve_change_group and both land in
  -- one transaction. This function will not invent a visit date it was not given.
  if v_verified is not null and not v_writes_stamp and not v_is_floor then
    execute format('update public.%I set %I = null where id = $1', pc.target_table, v_verified_col)
      using pc.target_id;
  end if;

  insert into public.change_log (
    target_table, target_id, room_id, operation, field,
    old_value, new_value, source_id, source_url, agent, applied_by
  ) values (
    pc.target_table, pc.target_id, pc.room_id, pc.operation, pc.field,
    pc.old_value, pc.new_value, pc.source_id, pc.source_url, pc.agent, v_reviewer
  );

  update public.pending_changes
     set state = 'approved', reviewed_at = now(), reviewed_by = v_reviewer
   where id = p_id;

  select slug into v_slug from public.rooms where id = pc.room_id;

  return jsonb_build_object(
    'id', p_id,
    'slug', v_slug,
    'operation', 'update',
    'created_id', null,
    'overrode_verified', v_verified is not null and not v_writes_stamp and not v_is_floor,
    'verified_was', v_verified,
    'incoming_kind', v_incoming_kind,
    'target_kind', v_target_kind
  );
end $$;
revoke all on function public.approve_change(uuid, boolean) from public;
grant execute on function public.approve_change(uuid, boolean) to authenticated;
