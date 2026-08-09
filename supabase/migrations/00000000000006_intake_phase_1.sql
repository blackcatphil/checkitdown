-- =====================================================================
-- INTAKE PHASE I — the queue becomes the only write path.
-- =====================================================================
-- The morning partner applies have been writing prod directly, because the
-- queue could not express three things they need: a proposal against an
-- amenity row, a verification stamp, and a row that does not exist yet.
-- This closes all three. After it lands, a direct write is a bug.
--
-- NO DATA CHANGES HERE. Machinery only — the seed self-check tuple must read
-- exactly what it read before this migration.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT ADD:
--
--   * `pending_changes.source_id` — IT ALREADY EXISTS, with the FK to
--     `sources`, since migration 1. The floor-stamp gate in (3) below reads
--     that column; nothing needed adding.
--   * `pending_changes.op` — the table has carried `operation change_op not
--     null default 'update'` since migration 1, and `change_op` is already
--     `enum ('insert','update','delete')`. Adding a second text column with a
--     CHECK would have meant two columns naming the same thing, one of them
--     weaker, and `approve_change` already copies `operation` into
--     `change_log`. Insert proposals use the column that is already there, so
--     every existing row is 'update' by definition and the detector — which
--     never sets it — keeps working untouched.
--
-- `change_op` also carries 'delete', which this path does NOT implement.
-- Refused explicitly below rather than falling through to the update branch
-- and silently doing nothing.
--
-- ---------------------------------------------------------------------
-- THE v1 LIMIT: ONE PROPOSAL CARRIES ONE CITATION.
-- ---------------------------------------------------------------------
-- `pending_changes` has a single source_url / fetched_at pair, and everything
-- below writes the fact's receipt from it. So a SPLIT-PROVENANCE row — one
-- document for the stakes and a different one for the rake — CANNOT be created
-- or corrected through a single proposal.
--
-- That shape is real and already in the data: the Wynn PLO rows cite the
-- long-form review doc for their stakes and the SinCityGrinders sheet for their
-- rake, because the doc carries no rake figure. The Orleans rows have the same
-- split against Boyd and Vegas Advantage.
--
-- The honest options through this path are:
--   * TWO PROPOSALS — insert the row citing the stakes document, then a rake
--     correction citing the rake document. The second moves rake_source_url
--     only, because a rake field moves the rake family's receipt. This works
--     today and produces the correct end state with two log entries, which is
--     arguably a better record than one.
--   * A HAND APPLY with its own receipt, the way 4a55228 was done.
--
-- What must NOT happen is a proposal growing a second citation field that the
-- reviewer cannot see in the queue. Naming the limit here so the next person
-- reaches for one of the two above rather than inventing a third.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. room_amenities becomes ADDRESSABLE.
-- ---------------------------------------------------------------------
-- `pending_changes.target_id` is a single uuid. room_amenities was keyed
-- (room_id, amenity_id) and had no id at all, which is why approve_change
-- refused it loudly — there was no way to name a row.
--
-- The natural key SURVIVES as a UNIQUE constraint. That is not tidiness: the
-- seed's `on conflict (room_id, amenity_id) do update` needs it, and losing it
-- would let one room hold two rows for the same amenity — a duplicate the
-- amenity filter would render as two contradictory answers to one question.
--
-- Nothing FK-references room_amenities (checked before writing this), so
-- demoting the primary key breaks no dependency.
--
-- RLS, the `public_read_room_amen` policy and the anon/authenticated SELECT
-- grants are attached to the TABLE, not to the constraint, so they carry over
-- untouched. That is asserted in pgTAP rather than assumed — this project has
-- lost an entire API to a policy that was present and inert, and "it should
-- carry over" is exactly the reasoning that produced it.
alter table public.room_amenities
  add column id uuid not null default gen_random_uuid(),
  add constraint room_amenities_room_amenity_key unique (room_id, amenity_id);

alter table public.room_amenities drop constraint room_amenities_pkey;
alter table public.room_amenities add constraint room_amenities_pkey primary key (id);

comment on column public.room_amenities.id is
  'Surrogate key, added in migration 6 so pending_changes.target_id can name '
  'this row. (room_id, amenity_id) remains UNIQUE and is still the natural key.';

-- ---------------------------------------------------------------------
-- 2. WHICH FIELDS A PROPOSAL MAY WRITE — one place, both operations.
-- ---------------------------------------------------------------------
-- Extracted from approve_change because insert and update must apply the SAME
-- rules. The first sketch validated the update path and looped the insert
-- payload past a second, shorter list — which is how an insert ends up able to
-- smuggle a stamp the update path refuses. One function, called from both.
--
-- Returns the refusal message, or NULL when the field may be written.
--
-- THE TWO TABLES ARE NOT TREATED IDENTICALLY, ON PURPOSE:
--
--   rooms / cash_games — DENYLIST, exactly as before. These have wide column
--     lists that the detector already proposes against, and converting them to
--     an allowlist in the same migration that changes three other things would
--     be an untested behaviour change to the one path in production use.
--
--   room_amenities — ALLOWLIST: available, detail. A new table on this path
--     with ten columns is cheap to enumerate, and an allowlist fails closed
--     when column eleven arrives.
--
-- NEITHER LIST CONTAINS A CITATION COLUMN. See the provenance branch below:
-- the receipt is moved by approve_change, not proposed as a value.
--
-- NOTE `detail`, NOT `note`. The intake brief asked for "note (if the column
-- exists)"; it does not. room_amenities has carried `detail` since migration 1
-- ('Grand Lux, 11a-11p'), and `note` exists on pending_changes and admins,
-- which is probably where the name came from. Writing a `note` column here
-- would have been a silent no-op behind a catalogue error.
create or replace function public.proposal_field_refusal(
  p_table          text,
  p_field          text,
  p_source_is_floor boolean,
  p_is_insert      boolean
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  -- Identity and machine-managed provenance: never, on any table, either op.
  if p_field in ('id', 'source_id', 'created_at', 'updated_at') then
    return format('field %s is provenance or identity and is not writable through a proposal', p_field);
  end if;

  -- room_id is never taken from a payload. On an update it would re-parent the
  -- row; on an insert the row's room comes from the proposal's own room_id,
  -- which has already been checked against the target, so a second copy in the
  -- payload could only ever disagree with it.
  if p_field = 'room_id' then
    return format('field %s is provenance or identity and is not writable through a proposal', p_field);
  end if;

  -- amenity_id: re-parenting on an update, but the PARENT KEY on an insert —
  -- there is no other way to say which amenity a new row is about.
  if p_field = 'amenity_id' then
    if p_table <> 'room_amenities' then
      return format('%s has no column %s', p_table, p_field);
    end if;
    if p_is_insert then
      return null;
    end if;
    return format('field %s is provenance or identity and is not writable through a proposal', p_field);
  end if;

  -- THE STAMPS. The only fields whose writability depends on something other
  -- than the field name — see (3). The refusal keeps the original denylist
  -- wording, because a non-floor proposal carrying a stamp is refused for
  -- exactly the original reason: research does not get to say a person stood
  -- somewhere.
  if p_field in ('verified_at', 'rake_verified_at') then
    if p_source_is_floor then
      return null;
    end if;
    return format('field %s is provenance or identity and is not writable through a proposal', p_field);
  end if;

  -- THE CITATION IS NEVER A PROPOSED VALUE — on any table, in either
  -- operation. It is written by approve_change from the proposal's OWN
  -- source_url / fetched_at, because the receipt has to follow the fact and a
  -- payload copy could only ever disagree with the proposal that carried it.
  --
  -- This list used to be reached only by rooms/cash_games, with source_url and
  -- fetched_at sitting in the room_amenities ALLOWLIST just below — writable as
  -- ordinary fields. That combination is incoherent once the receipt moves
  -- automatically: a proposal with field = 'source_url' would write new_value
  -- and then have it immediately overwritten by pc.source_url, two mechanisms
  -- fighting over one column. It is also wrong by the project's own rule — a
  -- citation moves BECAUSE A VALUE MOVED, never on its own, which is the whole
  -- content of the 08-06/08-08 corroboration-versus-correction cleanup.
  if p_field in ('fetched_at', 'source_url', 'rake_fetched_at', 'rake_source_url') then
    return format('field %s is provenance or identity and is not writable through a proposal', p_field);
  end if;

  if p_table = 'room_amenities' then
    if p_field in ('available', 'detail') then
      return null;
    end if;
    return format('field %s is not writable on room_amenities through a proposal', p_field);
  end if;

  return null;
end $$;

revoke all on function public.proposal_field_refusal(text, text, boolean, boolean) from public;

comment on function public.proposal_field_refusal(text, text, boolean, boolean) is
  'Returns the refusal message for a proposed field write, or NULL if it is '
  'permitted. Called by approve_change for BOTH the update path and every key '
  'of an insert payload, so the two cannot drift apart.';

-- ---------------------------------------------------------------------
-- 3 + 4. approve_change: amenities, floor stamps, and inserts.
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
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into pc from public.pending_changes where id = p_id for update;
  if not found then
    raise exception 'no such pending change: %', p_id using errcode = 'P0002';
  end if;
  if pc.state <> 'pending' then
    raise exception 'change % is already %', p_id, pc.state using errcode = '22023';
  end if;

  if pc.target_table not in ('rooms', 'cash_games', 'room_amenities') then
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
    else
      if not exists (
        select 1 from public.room_amenities ra
         where ra.id = pc.target_id and ra.room_id = pc.room_id
      ) then
        raise exception 'target row % does not belong to room %', pc.target_id, pc.room_id
          using errcode = '22023';
      end if;
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

  -- THE PARTNER'S DATA IS LAW, enforced rather than described.
  if v_verified is not null and not p_override_verified then
    raise exception 'change % targets a fact verified in person on %; pass p_override_verified to proceed',
      p_id, v_verified::date using errcode = '22023';
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
  if v_verified is not null and not v_writes_stamp then
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
    'overrode_verified', v_verified is not null and not v_writes_stamp,
    'verified_was', v_verified
  );
end $$;

revoke all on function public.approve_change(uuid, boolean) from public;
grant execute on function public.approve_change(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 5. The queue view learns amenities, the source, and the operation.
-- ---------------------------------------------------------------------
-- `fact_verified_at` gains its room_amenities branch — without it every
-- amenity proposal renders as "not verified in person", which is the
-- under-reporting direction the provenance block was fixed for.
--
-- `source_id` comes straight off `pending_changes` — NO JOIN TO `sources`.
--
-- THE JOIN WAS THE FIRST VERSION AND IT BROKE THE WHOLE QUEUE. This view is
-- `security_invoker = on`, deliberately: it reads privileged rows and must
-- carry the caller's identity into the `pending_changes` policy rather than
-- bypass it. But invoker rights apply to EVERY relation it touches, and
-- `sources` is service_only — no grant to `authenticated` at all. So adding
-- `left join sources` to fetch a label made the view raise 42501 for admins and
-- non-admins alike: not "you see no rows", but "you may not ask". The pgTAP
-- identity test caught it as -1 where it wanted 0, which is exactly the
-- distinction that assertion was written to preserve.
--
-- The label the bulk control needs comes from `pending_source_groups()` below,
-- which is SECURITY DEFINER and gated on is_admin() — the same shape as
-- `detector_status()`. `sources` stays closed.
--
-- DROPPED AND RECREATED, NOT REPLACED. `create or replace view` may only APPEND
-- columns — it refuses to insert one mid-list with
-- `cannot change name of view column "field" to "operation"`, because it
-- matches the new column list against the old one positionally. The new columns
-- belong next to the ones they relate to rather than bolted onto the end, so
-- the view goes and comes back. Nothing else depends on it, and the grant below
-- is reissued because DROP takes the grant with it.
drop view if exists public.pending_review;

create view public.pending_review with (security_invoker = on) as
select
  pc.id,
  pc.state,
  pc.target_table,
  pc.target_id,
  pc.room_id,
  r.slug        as room_slug,
  r.name        as room_name,
  pc.operation,
  pc.field,
  pc.old_value,
  pc.new_value,
  pc.confidence,
  pc.agent,
  pc.note,
  pc.source_id,
  pc.source_url,
  pc.fetched_at,
  pc.created_at,
  case
    when pc.target_table = 'cash_games' and pc.field like 'rake%'
      then (select cg.rake_verified_at from public.cash_games cg where cg.id = pc.target_id)
    when pc.target_table = 'cash_games'
      then (select cg.verified_at from public.cash_games cg where cg.id = pc.target_id)
    when pc.target_table = 'rooms'
      then (select ro.verified_at from public.rooms ro where ro.id = pc.target_id)
    when pc.target_table = 'room_amenities'
      then (select ra.verified_at from public.room_amenities ra where ra.id = pc.target_id)
  end as fact_verified_at
from public.pending_changes pc
left join public.rooms r on r.id = pc.room_id;

comment on view public.pending_review is
  'The review queue. Adds the verification state of the fact each proposal '
  'targets, which is the difference between a routine correction and a claim '
  'that the floor data has gone stale. Source LABELS are not joined here — '
  '`sources` is service_only and this view is security_invoker; see '
  'pending_source_groups().';

grant select on public.pending_review to authenticated;

-- ---------------------------------------------------------------------
-- 6. What a bulk approval is scoped to: one document, and its cost.
-- ---------------------------------------------------------------------
-- "Approve everything from the partner sheet" is a decision about a DOCUMENT,
-- so the reviewer has to see which document and how much rides on it. This
-- returns exactly that, and it is SECURITY DEFINER for the same reason
-- `detector_status()` is: `sources` stays closed to authenticated, and the way
-- to expose one fact from a closed table is a gated function, not a grant.
--
-- `would_override` is the number of proposals in the group that target a
-- person-verified fact. Those are the rows the bulk control deliberately will
-- NOT apply — it passes p_override_verified = false — so the count belongs on
-- the button rather than being discovered when the run stops. A control that
-- offers to approve sixty and applies forty-three has lied to the reviewer.
--
-- Proposals with no source_id are absent by construction: "approve everything
-- unattributed" is not a decision anyone should make in one click.
create or replace function public.pending_source_groups()
returns table (
  source_id      uuid,
  label          text,
  data_type      text,
  pending        int,
  would_override int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return query
    select s.id, s.label, s.data_type,
           count(*)::int,
           count(*) filter (where pr.fact_verified_at is not null)::int
      from public.pending_review pr
      join public.sources s on s.id = pr.source_id
     where pr.state = 'pending'
     group by s.id, s.label, s.data_type
     order by count(*) desc, s.label;
end $$;

revoke all on function public.pending_source_groups() from public;
grant execute on function public.pending_source_groups() to authenticated;
