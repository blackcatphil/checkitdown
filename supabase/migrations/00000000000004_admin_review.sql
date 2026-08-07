-- =====================================================================
-- ADMIN REVIEW — identity in the DATABASE, not in a service key.
-- =====================================================================
-- `pending_changes` and `change_log` have existed since the first migration
-- with no writer and no reader. This gives them both, and it does it without
-- SUPABASE_SERVICE_ROLE_KEY ever reaching the app or Vercel.
--
-- That constraint is the whole design. A service key in the app would make
-- every route a potential full-database write path, and the only thing standing
-- between a reader and the maintenance loop would be application code. Here the
-- database decides: a session is an admin because a row says so, and every
-- privileged action runs through a function that re-checks it.
--
-- THE PRECEDENCE MODEL THIS ENFORCES:
--   * The partner's floor data is LAW. Nothing a scraper finds overwrites a
--     person-verified row on its own.
--   * Scrapers are CHANGE DETECTORS. They may INSERT a proposal and nothing
--     else — they hold no UPDATE on any fact table through this path.
--   * Precedence is by RECENCY OF HUMAN CHECK, not by source class. A scrape
--     dated after the verification is not wrong by definition; it is the case
--     the product exists to catch, so it is surfaced rather than buried.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Who is an admin. An allowlist of one to start.
-- ---------------------------------------------------------------------
create table public.admins (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

comment on table public.admins is
  'Admin allowlist, keyed by the email on the auth JWT. Deliberately NOT '
  'readable by anon or authenticated — is_admin() reads it as definer so a '
  'session can be checked without the list itself being public.';

-- NO ROWS HERE, DELIBERATELY. The repo is public, and a migration that names a
-- real person's address publishes it to everyone who clones — and makes the
-- test suite unrunnable by anyone who is not that person. The allowlist is
-- OPERATIONAL DATA, not schema: it is applied by
-- `scripts/bootstrap-admin.sql` (gitignored), or by hand.
--
--   psql "$DATABASE_URL" -v email=you@example.com -f scripts/bootstrap-admin.sql
--
-- The structure is what belongs in version control; who happens to hold the
-- privilege today does not.

-- ---------------------------------------------------------------------
-- is_admin() — the single definition of the privilege.
-- ---------------------------------------------------------------------
-- SECURITY DEFINER so it can read `admins` while `admins` stays closed to
-- everybody. `search_path` is pinned: a definer function that resolves
-- unqualified names against the caller's path is a privilege-escalation bug,
-- not a style problem.
--
-- Email is compared case-insensitively because an identity provider will
-- happily hand back a differently-cased address than the one typed into the
-- allowlist, and "admin access silently stopped working" is a bad afternoon.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.admins a
     where lower(a.email) = lower(nullif(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- pending_changes: admins read and triage; scrapers only propose.
-- ---------------------------------------------------------------------
-- A GRANT alone would let any signed-in user read the queue, and a POLICY alone
-- would be inert — this project has already lost an entire API to exactly that
-- half-measure, so both are stated.
grant select, update on public.pending_changes to authenticated;

create policy pending_changes_admin_select on public.pending_changes
  for select to authenticated
  using (public.is_admin());

-- WITH CHECK as well as USING: without it an admin could update a row out of
-- their own visibility, which is a strange thing to allow and a stranger thing
-- to debug.
create policy pending_changes_admin_update on public.pending_changes
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Proposals arrive from the scrapers, which run as service_role. No policy is
-- needed for that role — it bypasses RLS — but the absence of an INSERT policy
-- for `authenticated` is the point: an admin reviews proposals, and cannot
-- manufacture one to approve.
create policy change_log_admin_select on public.change_log
  for select to authenticated
  using (public.is_admin());

grant select on public.change_log to authenticated;

-- ---------------------------------------------------------------------
-- Applying a change. One function, one transaction.
-- ---------------------------------------------------------------------
-- The admin session holds no INSERT on change_log and no UPDATE on any fact
-- table. It cannot: those are exactly the privileges a compromised session
-- would want. Instead it calls this, which re-checks is_admin() itself and does
-- the whole job atomically — a function body IS a transaction, so a fact table
-- can never be updated without its log row landing too.
--
-- WHY AN ALLOWLIST RATHER THAN TRUSTING `target_table`/`field`: they are text
-- columns written by a scraper. Interpolating them into DDL would hand any
-- writer of pending_changes an arbitrary UPDATE. Both are checked against the
-- catalogue before they are used, and the column's real type comes from the
-- catalogue too, so a numeric column is not fed a string.
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
  pc            public.pending_changes;
  v_coltype     text;
  v_slug        text;
  v_verified    timestamptz;
  v_verified_col text;
  v_reviewer    text := nullif(auth.jwt() ->> 'email', '');
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

  -- Only tables with a single-column `id` are applicable through this path.
  -- room_amenities is keyed (room_id, amenity_id) and has no id, so it is
  -- refused loudly rather than silently updating nothing.
  if pc.target_table not in ('rooms', 'cash_games') then
    raise exception 'target table % is not applicable through this path', pc.target_table
      using errcode = '22023';
  end if;
  if pc.field is null then
    raise exception 'a field is required to apply an update' using errcode = '22023';
  end if;

  -- FIX: A PROPOSAL MAY CHANGE A FACT. IT MAY NEVER CHANGE PROVENANCE.
  -- Validating `field` against the catalogue proves the column exists, which is
  -- not the same as proving it may be written. Every one of these is a
  -- catalogue-valid column, so without this list a scraper could propose
  -- `verified_at = now()` and approval would write it — research setting a
  -- verification stamp, which the seeding rule forbids everywhere else in the
  -- product. The stamp means a person stood there; nothing fetched over HTTP
  -- can create one.
  -- `id` and `room_id` are here for a different reason: rewriting a key turns
  -- an update into a silent re-parenting of the row.
  if pc.field = any (array[
    'id', 'room_id',
    'verified_at', 'fetched_at', 'source_id', 'source_url',
    'rake_verified_at', 'rake_fetched_at', 'rake_source_url',
    'created_at', 'updated_at'
  ]) then
    raise exception 'field % is provenance or identity and is not writable through a proposal', pc.field
      using errcode = '42501';
  end if;

  -- FIX: THE TARGET ROW MUST BELONG TO THE ROOM THE PROPOSAL NAMES.
  -- A valid foreign key pointing at the wrong document is the Westgate
  -- provenance bug, and here it lands in the WRITE path: one room's fact gets
  -- updated, another room's change_log entry gets written, and a third page
  -- gets revalidated. Every downstream artefact would be internally consistent
  -- and collectively wrong.
  if pc.room_id is null then
    raise exception 'a proposal must name the room it belongs to' using errcode = '22023';
  end if;
  if pc.target_table = 'rooms' then
    if pc.target_id is distinct from pc.room_id then
      raise exception 'proposal targets room % but names room %', pc.target_id, pc.room_id
        using errcode = '22023';
    end if;
  else
    if not exists (
      select 1 from public.cash_games cg
       where cg.id = pc.target_id and cg.room_id = pc.room_id
    ) then
      raise exception 'target row % does not belong to room %', pc.target_id, pc.room_id
        using errcode = '22023';
    end if;
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

  -- IS THE FACT BEING CHANGED PERSON-VERIFIED? Rake carries its own stamp, so
  -- the answer depends on which field is being replaced, not just which row.
  v_verified_col := case
    when pc.target_table = 'cash_games' and pc.field like 'rake%' then 'rake_verified_at'
    else 'verified_at'
  end;
  execute format('select %I from public.%I where id = $1', v_verified_col, pc.target_table)
    into v_verified using pc.target_id;

  -- THE PARTNER'S DATA IS LAW, and this is where that is enforced rather than
  -- described. A person-verified fact is not overwritten by a proposal unless
  -- the reviewer says so in the call itself. The default is refusal.
  if v_verified is not null and not p_override_verified then
    raise exception 'change % targets a fact verified in person on %; pass p_override_verified to proceed',
      p_id, v_verified::date using errcode = '22023';
  end if;

  execute format('update public.%I set %I = ($1 #>> ''{}'')::%s where id = $2',
                 pc.target_table, pc.field, v_coltype)
    using pc.new_value, pc.target_id;

  -- A VALUE A PERSON HAS NOT SEEN IS NOT PERSON-VERIFIED. Overriding keeps the
  -- floor visit in the log but drops the claim from the row: the stamp means
  -- "somebody stood there and saw THIS", and after an override nobody has.
  if v_verified is not null then
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
    'overrode_verified', v_verified is not null,
    'verified_was', v_verified
  );
end $$;

create or replace function public.reject_change(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reviewer text := nullif(auth.jwt() ->> 'email', '');
  v_slug     text;
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- Rejection writes NOTHING but the verdict: no fact changes, no change_log
  -- row. A log of things that did not happen is noise in the one place that has
  -- to stay readable.
  update public.pending_changes
     set state = 'rejected', reviewed_at = now(), reviewed_by = v_reviewer
   where id = p_id and state = 'pending'
  returning (select slug from public.rooms where id = room_id) into v_slug;

  if not found then
    raise exception 'no pending change %', p_id using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id, 'slug', v_slug);
end $$;

revoke all on function public.approve_change(uuid, boolean) from public;
revoke all on function public.reject_change(uuid) from public;
grant execute on function public.approve_change(uuid, boolean) to authenticated;
grant execute on function public.reject_change(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- The queue, with the one column the reviewer cannot triage without.
-- ---------------------------------------------------------------------
-- A proposal is meaningless on its own: "rake_cap should be 8" matters
-- completely differently depending on whether a person stood in that room last
-- week and wrote down 6. This view answers that per row, and orders so the rows
-- that can teach us something rise.
--
-- SECURITY INVOKER, unlike source_kinds: this reads privileged rows and must
-- carry the caller's identity into the underlying policy, not bypass it.
create view public.pending_review with (security_invoker = on) as
select
  pc.id,
  pc.state,
  pc.target_table,
  pc.target_id,
  pc.room_id,
  r.slug        as room_slug,
  r.name        as room_name,
  pc.field,
  pc.old_value,
  pc.new_value,
  pc.confidence,
  pc.agent,
  pc.note,
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
  end as fact_verified_at
from public.pending_changes pc
left join public.rooms r on r.id = pc.room_id;

comment on view public.pending_review is
  'The review queue. Adds the verification state of the fact each proposal '
  'targets, which is the difference between a routine correction and a claim '
  'that the floor data has gone stale.';

grant select on public.pending_review to authenticated;

-- ---------------------------------------------------------------------
-- Has the detector ever run? "Empty" has two meanings.
-- ---------------------------------------------------------------------
-- An empty queue means "we checked and nothing moved" OR "nobody has looked",
-- and those are opposite statements that render identically. The amenities
-- block already makes this distinction for a room; the queue needs it too.
--
-- `sources.content_hash` is the marker: the seed leaves it null, and only a
-- detector run sets it. Definer, because `sources` stays service_only — and
-- gated on is_admin() inside, since a definer function granted to
-- `authenticated` is otherwise a hole in exactly the wall it sits in.
create or replace function public.detector_status()
returns table (last_run timestamptz, sources_read int, sources_failing int)
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
    select max(s.last_fetched_at) filter (where s.content_hash is not null),
           count(*) filter (where s.content_hash is not null and s.status = 'ok')::int,
           count(*) filter (where s.content_hash is not null and s.status <> 'ok')::int
      from public.sources s;
end $$;

revoke all on function public.detector_status() from public;
grant execute on function public.detector_status() to authenticated;
