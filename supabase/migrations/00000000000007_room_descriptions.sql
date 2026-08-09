-- ---------------------------------------------------------------------
-- ROOM DESCRIPTIONS — prose on the room page, with provenance.
-- Phil ruled 2026-08-09.
--
-- WHY A TABLE AND NOT A COLUMN PAIR ON `rooms`.
--
-- A description is a fact with its OWN citation, and the child-provenance rule
-- says a row cites where its own fact came from. On `rooms` that citation would
-- have to be prefixed — `description_source_url`, `description_fetched_at` —
-- and that is where the column-pair design quietly breaks:
-- `proposal_field_refusal` refuses a proposed citation write by EXACT NAME
-- ('source_url', 'fetched_at', 'rake_source_url', 'rake_fetched_at'). A new
-- prefixed citation column matches none of them, so it would land as an
-- ordinary writable field and the receipt-is-never-proposed rule would have a
-- hole in it from the day the column shipped — silently, with nothing failing.
--
-- A child table's citation columns are named exactly `source_url` /
-- `fetched_at` / `verified_at`, hit the existing denylist unchanged, and cost
-- no new rule anybody has to remember. That is the whole argument.
--
-- ONE DESCRIPTION PER ROOM (`unique (room_id)`), because replacing a Check It
-- Down placeholder with a partner review is a CONTENT SWAP: an update to
-- `body` and `author_kind` through the queue, no code change and no second row
-- to decide between. Deciding which of two rows wins is exactly the kind of
-- judgement a schema should not force onto a renderer.
-- ---------------------------------------------------------------------

-- AUTHORSHIP IS STORED AND NEVER RENDERED. Phil ruled 2026-08-09 that every
-- description reads in the product's voice: a partner review and a Check It
-- Down description look identical to a reader, with no byline on either. The
-- column exists so the swap above is a data change rather than a code change,
-- and so we can answer "how much of this is ours" internally. It is not a
-- display field, and the room page never selects it.
create type description_author as enum ('partner', 'checkitdown');

create table room_descriptions (
  id          uuid primary key default gen_random_uuid(),

  -- CASCADE, unlike a source reference: a description is not a fact that
  -- survives its room. If the room row goes, the prose about it is not
  -- something to keep pointing at nothing.
  room_id     uuid not null unique references rooms(id) on delete cascade,

  body        text not null,
  author_kind description_author not null,

  -- STALENESS IS DATED, NOT HIDDEN. Rendered beside the prose the way every
  -- other fact shows its verified date. Chris's Golden Nugget review says
  -- "recently relocated" — true today, dating itself within a year — and the
  -- answer to that is a visible date, not a ban on time-relative language.
  -- NOT NULL: undated prose is the same failure as an undated closure.
  written_at  date not null,

  -- Provenance, named to match every other fact table in this schema.
  source_url  text,
  fetched_at  timestamptz,
  verified_at timestamptz,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint description_is_not_blank check (length(btrim(body)) > 0),

  -- ⚠️ NO FIGURES TYPED INTO PROSE, made UNREPRESENTABLE rather than merely
  -- discouraged. This repo has run two sweeps for stale hardcoded numbers, and
  -- prose is where they survive longest: a paragraph reading "$1/2 and $2/5"
  -- keeps saying that for a year after the room drops $1/2, and no gate that
  -- looks at code will ever see it.
  --
  -- A description that needs a figure carries a TOKEN — {stakes_lowest},
  -- {rake_lowest}, {table_count} — resolved at render time from the same query
  -- and the same formatter the facts grid uses, so an approved queue change
  -- moves the paragraph in the same breath as the grid.
  --
  -- Currency only. Dates and bare integers are deliberately NOT refused here:
  -- "open 24 hours" and "since the seventies" are prose, item 4 answers
  -- time-relative language with a visible written_at, and a constraint broad
  -- enough to catch every risky integer would refuse ordinary English. The
  -- render-time probe is the wider net — it checks the RENDERED paragraph
  -- against the room's own data, which catches a mis-wired token too, and a
  -- token is the only way a figure can legitimately get there.
  constraint description_states_no_currency check (body !~ '\$[0-9]')
);

comment on table room_descriptions is
  'Prose for a room page. One row per room. Figures are never typed into '
  '`body` — they are tokens resolved from the room''s own data at render time. '
  '`author_kind` is stored for content management and is NEVER rendered.';

comment on column room_descriptions.author_kind is
  'Stored, never displayed. Exists so replacing a Check It Down placeholder '
  'with a partner review is a content swap, not a code change.';

create index room_descriptions_room_idx on room_descriptions (room_id);

-- ---------------------------------------------------------------------
-- RLS + GRANTS. Policies are inert without explicit grants — the whole
-- content of migration 002 — so both land here, together.
-- ---------------------------------------------------------------------
alter table room_descriptions enable row level security;

create policy public_read_descriptions on room_descriptions for select using (true);

revoke all on room_descriptions from anon, authenticated;
grant select on room_descriptions to anon, authenticated;

-- ---------------------------------------------------------------------
-- THE QUEUE IS THE ONLY WRITE PATH, and it stays that way for prose.
-- The four partner reviews and the thirteen Check It Down descriptions are
-- staged as proposals and approved in /admin/review — they do not arrive in a
-- migration, and they do not arrive in a commit.
-- ---------------------------------------------------------------------
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

  -- PROSE. An ALLOWLIST, for the same reason room_amenities got one: a new
  -- table on this path is cheap to enumerate, and an allowlist fails closed
  -- when column eleven arrives.
  --
  -- `body` and `written_at` are the fact. `author_kind` is the
  -- content-management flag that makes replacing a Check It Down placeholder
  -- with a partner review a DATA change rather than a code change — it is
  -- stored, never rendered, and it still arrives through the queue like
  -- everything else. The citation columns are absent here and refused above,
  -- unchanged.
  if p_table = 'room_descriptions' then
    if p_field in ('body', 'author_kind', 'written_at') then
      return null;
    end if;
    return format('field %s is not writable on room_descriptions through a proposal', p_field);
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
-- approve_change learns the table.
--
-- REDEFINED IN FULL, the way 006 did it, rather than patched. The first draft
-- of this migration rewrote the function text at runtime via
-- pg_get_functiondef + string replace, which is both unreviewable in a diff and
-- silently wrong here: the ownership check ended in an `else` that assumed
-- room_amenities, so the anchor it looked for did not exist. A migration is a
-- record, and a record you cannot read is not one.
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
