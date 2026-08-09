-- =====================================================================
-- THE PRECEDENCE LAW — and the end of approval as the normal path.
-- Phil ruled 2026-08-09.
-- =====================================================================
--
-- ═══ APPROVAL IS NO LONGER HOW ORDINARY DATA ARRIVES ═══
--
-- Say it plainly, because the queue is still here and a reader will otherwise
-- assume it is still the road: `pending_changes`, `pending_review` and
-- /admin/review REMAIN, and the normal pipeline does not use them. Partner
-- documents and web research now apply DIRECTLY, on a schedule, with no human
-- saying yes. The queue is kept for what the law does not cover, and so a
-- person can still look at something on purpose.
--
-- What changed is which question the database asks. It used to ask
--
--     "has a human approved this write onto a verified fact?"
--
-- which made a person the gate and put them in the loop for data that was never
-- in doubt. It now asks
--
--     "which source outranks which?"
--
-- and answers from the two sources' own `data_type`. That is PRECEDENCE rather
-- than PERMISSION, and the difference is that precedence cannot be waived by
-- someone in a hurry:
--
--     floor -> web         APPLY
--     floor -> unsourced   APPLY
--     floor -> floor       REFUSE unless p_override_verified
--     web   -> web         APPLY
--     web   -> unsourced   APPLY
--     web   -> floor       REFUSE — and no flag lifts it
--
-- A refusal is not queued and not flagged. It is declined, named with both
-- sources, and counted by the caller. SQLSTATE 'CID03' marks it so the differ
-- can tell "the law said no" from "something broke" — a distinction that
-- decides whether Phil reads a summary line or a bug report.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. WHAT KIND OF SOURCE IS THIS?
-- ---------------------------------------------------------------------
-- One definition, used for both sides of every comparison. Two callers with
-- their own idea of "floor" is how a precedence rule quietly stops holding.
create or replace function public.source_kind_of(p_url text, p_source_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when coalesce(
      (select s.data_type from public.sources s where s.id = p_source_id),
      (select s.data_type from public.sources s where s.url = p_url limit 1)
    ) = 'floor' then 'floor'
    when p_source_id is not null or p_url is not null then 'web'
    else null
  end
$$;

comment on function public.source_kind_of(text, uuid) is
  'floor | web | null for a citation. `web` means "a source that is not a floor '
  'visit" — the law has two ranks, not a taxonomy of the internet.';

-- ---------------------------------------------------------------------
-- 2. WHAT KIND OF SOURCE IS THE FACT WE ARE ABOUT TO OVERWRITE?
-- ---------------------------------------------------------------------
-- THE STAMP IS FLOOR EVIDENCE IN ITS OWN RIGHT, and this is the subtle half of
-- the law. A floor visit that CONFIRMS an existing number keeps the original
-- citation — that is the corroboration-versus-correction rule, and South Point
-- is person-verified while still citing Vegas Advantage. Read the citation
-- alone and that fact classifies as `web`, which would let a web scrape
-- overwrite a figure somebody physically stood in a room and confirmed. So
-- verified_at counts, and it counts FIRST.
--
-- WHICH STAMP AND WHICH CITATION depends on the FACT FAMILY, not the row: rake
-- carries its own pair on cash_games, which is what lets Orleans cite Boyd for
-- its stakes and Vegas Advantage for its cap on one row.
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
  v_is_rake  boolean := (p_table = 'cash_games' and p_field like 'rake%');
  v_verified timestamptz;
  v_url      text;
begin
  if p_table = 'cash_games' and v_is_rake then
    select rake_verified_at, rake_source_url into v_verified, v_url
      from public.cash_games where id = p_id;
    -- NULL rake_source_url means "the rake came from this row's own
    -- source_url" — the coalesce is the documented reading of that column, and
    -- omitting it would classify every room that never split its citations as
    -- unsourced.
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
    -- Not a plausible-looking guess. A table this function does not know is a
    -- table whose provenance columns nobody has checked, and returning `web`
    -- would silently make its facts overwritable.
    raise exception 'fact_source_kind does not know table %', p_table
      using errcode = '22023';
  end if;

  if v_verified is not null then return 'floor'; end if;
  return public.source_kind_of(v_url, null);
end $$;

comment on function public.fact_source_kind(text, uuid, text) is
  'The precedence rank of the fact a write is aiming at. verified_at counts as '
  'floor evidence even when the row still cites the web source it corroborated.';


-- ---------------------------------------------------------------------
-- 2b. WHO MAY APPLY, now that nobody approves.
-- ---------------------------------------------------------------------
-- The scheduled differ holds the DATABASE CREDENTIAL. It does not sign in, it
-- carries no JWT, and `is_admin()` — which reads an email out of auth.jwt() —
-- is therefore false for it. Before this, the pipeline the whole ruling depends
-- on could not write a single row.
--
-- SESSION_USER, NOT CURRENT_USER. Inside a SECURITY DEFINER function
-- current_user is the function's OWNER, so it reads `postgres` for every caller
-- alive and would have opened this to anon. session_user is the role that
-- actually connected and is untouched by the definer switch. Verified rather
-- than assumed: current_user=postgres session_user=postgres inside a definer.
--
-- THIS GRANTS NOTHING NEW. A caller holding the postgres credential can already
-- UPDATE any row directly; the point of routing it through approve_change is
-- that the citation rules, the receipt move, the change_log entry and the
-- precedence law all apply to it. PostgREST connects as `authenticator` and
-- switches to anon/authenticated, so no web request can ever satisfy this —
-- which the auth probe asserts over HTTP rather than by reading this comment.
create or replace function public.is_service_caller()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select session_user in ('postgres', 'supabase_admin')
$$;

revoke all on function public.is_service_caller() from public;

comment on function public.is_service_caller() is
  'True for a process holding the database credential directly (the scheduled '
  'differ), false for anything arriving through PostgREST.';

-- ---------------------------------------------------------------------
-- 3. approve_change, under the law.
-- ---------------------------------------------------------------------
-- Redefined in full rather than patched — a migration is a record.
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
    when pc.target_table = 'cash_games' and pc.field like 'rake%' then 'rake_verified_at'
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
    if pc.target_table = 'cash_games' and pc.field like 'rake%' then
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
revoke all on function public.source_kind_of(text, uuid) from public;
revoke all on function public.fact_source_kind(text, uuid, text) from public;

-- ---------------------------------------------------------------------
-- 4. RAKE FIELDS MOVE AS A GROUP.
-- ---------------------------------------------------------------------
-- `rake_model_coherent` makes an incoherent rake row unrepresentable, and it is
-- symmetric: no figures without a model, and no figures a model does not use.
-- So "this room gains a rake" cannot be expressed one field at a time — applied
-- singly, the first write is refused by the constraint. Horseshoe needed the
-- model applied before the figures, by hand, for exactly this reason.
--
-- THE ORDER IS DERIVED FROM THE CONSTRAINT, NOT FROM A HABIT. A fixed
-- "rake_type first" is right for gaining a model and WRONG for losing one:
-- setting rake_type = null while a cap is still sitting there violates the
-- first branch. So the group is applied in three passes:
--
--   1. figures being CLEARED   (pot -> time must drop percent/cap/drop first)
--   2. rake_type               (the model itself)
--   3. figures being SET       (a model is in place to receive them)
--
-- Walk it: null->pot+cap is (nothing, model, cap). pot->null is (figures,
-- model, nothing). pot->time is (percent/cap/drop, model, time_charge). Every
-- intermediate row satisfies the constraint, which is why this works without
-- deferring anything — and CHECK constraints in Postgres cannot be deferred, so
-- ordering was never optional.
--
-- ONE TRANSACTION: a function body is one, so a refusal anywhere — precedence
-- or constraint — leaves the row exactly as it was. A half-applied rake model
-- is the thing this is for.
--
-- IT REUSES approve_change UNCHANGED. Every citation rule, the
-- receipt-follows-the-fact move and the change_log write live in there, and a
-- second write path is how those rot.
create or replace function public.approve_change_group(
  p_ids uuid[],
  p_override_verified boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows      uuid[];
  v_applied   jsonb := '[]'::jsonb;
  r           record;
begin
  if not (public.is_admin() or public.is_service_caller()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'approve_change_group needs at least one change' using errcode = '22023';
  end if;

  -- ONE ROW PER GROUP. The ordering below reasons about a single row's rake
  -- model; handed two rows it would interleave them and the guarantee would
  -- quietly stop being true.
  select array_agg(distinct target_id) into v_rows
    from public.pending_changes where id = any(p_ids);
  if array_length(v_rows, 1) <> 1 then
    raise exception 'a group must target exactly one row, got %', array_length(v_rows, 1)
      using errcode = '22023';
  end if;

  for r in
    select pc.id
      from public.pending_changes pc
     where pc.id = any(p_ids)
     order by
       case
         -- 1. clearing a figure
         when pc.field <> 'rake_type'
          and (pc.new_value is null or jsonb_typeof(pc.new_value) = 'null') then 0
         -- 2. the model
         when pc.field = 'rake_type' then 1
         -- 3. setting a figure
         else 2
       end,
       -- Deterministic within a pass, so a failure is reproducible.
       pc.field
  loop
    v_applied := v_applied || public.approve_change(r.id, p_override_verified);
  end loop;

  return jsonb_build_object('applied', v_applied, 'count', jsonb_array_length(v_applied));
end $$;

revoke all on function public.approve_change_group(uuid[], boolean) from public;
grant execute on function public.approve_change_group(uuid[], boolean) to authenticated;

comment on function public.approve_change_group(uuid[], boolean) is
  'Apply several pending changes to ONE row in a single transaction, ordered so '
  'no intermediate state violates rake_model_coherent. Calls approve_change for '
  'each — there is no second write path.';
