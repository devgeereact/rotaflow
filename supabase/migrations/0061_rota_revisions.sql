-- =====================================================================
-- 0061_rota_revisions.sql — make Draft, Published and Amended explicit,
-- and enforce them in the database rather than in the UI.
--
-- The defect this closes (BUG-028): the Rota Builder printed
-- "Editing a shift returns its rota to draft" on every published week and
-- it was false in every code path. createShift/updateShift/deleteShift
-- never touched the parent rota, and 'draft' was written only by
-- createDraftRota and the explicit unpublishRota. A manager moving a
-- published shift from 07:00 to 08:00 changed what staff saw instantly,
-- with no republish, no notification and no published_at bump — while
-- being told the opposite.
--
-- Two readings of the promised behaviour were possible and they are not
-- compatible on one row:
--
--   (a) flip the rota back to draft on edit — but a draft is not visible
--       to staff, so the week silently EMPTIES on their phones until the
--       manager republishes. That is worse than the bug.
--   (b) keep the published rota exactly as staff were told, and edit a
--       separate revision.
--
-- (b) is what this implements, and it is what the acceptance criteria
-- actually describe ("the original published version remains visible
-- until republished").
--
--   rotas
--     P  status=published                      <- staff read this
--     R  status=draft  supersedes_rota_id=P    <- the manager edits this
--
--   publish(R):  R -> published, P -> archived, atomically.
--
-- Staff read paths need no change at all: they already filter on
-- `rota.status = 'published'`, and both the revision (draft) and the
-- superseded original (archived) fall outside that filter.
--
-- Enforcement is server-side because the audit found the rule stated in
-- one screen's copy and honoured by none of the mutation paths. Three
-- guards, none of which a screen or a direct PostgREST call can bypass:
--
--   1. shifts_guard_immutable_rota  — no INSERT/UPDATE/DELETE of a shift
--      belonging to a published or archived rota.
--   2. rotas_guard_status_change    — a rota is born a draft, and status
--      transitions come only from the SECURITY DEFINER functions below,
--      which set a transaction-local flag. A raw PATCH of rotas.status,
--      or an INSERT that arrives pre-published, is refused.
--   3. rotas_published_unique_*     — at most one published rota per
--      org/location/period, the published-side counterpart of 0059's
--      draft indexes.
--
-- Both guards deliberately stand down when auth.uid() is null. That is
-- server-side code — the nightly retention job (0057) and Edge Functions
-- holding the service_role key — not an end user, and retention has to be
-- able to delete seven-year-old published rotas.
-- =====================================================================

-- ── 1. Schema ────────────────────────────────────────────────────────
alter table public.rotas
  drop constraint if exists rotas_status_check;
alter table public.rotas
  add constraint rotas_status_check
  check (status in ('draft', 'published', 'archived'));

alter table public.rotas
  add column if not exists supersedes_rota_id uuid
    references public.rotas(id) on delete set null,
  add column if not exists archived_at   timestamptz,
  add column if not exists created_by    uuid references auth.users(id) on delete set null,
  add column if not exists published_by  uuid references auth.users(id) on delete set null;

comment on column public.rotas.supersedes_rota_id is
  'Set on a draft REVISION of an already-published rota. Publishing this rota archives the one it supersedes, in the same transaction.';
comment on column public.rotas.archived_at is
  'When this rota stopped being the published version, because a revision of it was published in its place. Archived rotas are history: staff never see them, and they are never edited again.';
comment on column public.rotas.published_by is
  'Who last published this rota. The audit log is authoritative for the full history; this column exists so the current state can be shown without a join.';

create index if not exists rotas_supersedes_idx
  on public.rotas (supersedes_rota_id)
  where supersedes_rota_id is not null;

-- ── 2. Reconcile before constraining ─────────────────────────────────
-- 0059 restored uniqueness for drafts but nothing has ever stopped two
-- PUBLISHED rotas for one scope. Archive all but the newest before the
-- index below is created, otherwise this migration fails on live data.
-- Archive, never delete: a published rota is what staff were told, and
-- its shifts are real scheduled work.
with ranked as (
  select
    id,
    row_number() over (
      partition by org_id, location_id, period_start, period_end
      order by published_at desc nulls last, created_at desc, id
    ) as rn
  from public.rotas
  where status = 'published'
)
update public.rotas r
   set status = 'archived',
       archived_at = timezone('utc', now())
  from ranked
 where r.id = ranked.id
   and ranked.rn > 1;

create unique index if not exists rotas_published_unique_location
  on public.rotas (org_id, location_id, period_start, period_end)
  where status = 'published' and location_id is not null;

create unique index if not exists rotas_published_unique_no_location
  on public.rotas (org_id, period_start, period_end)
  where status = 'published' and location_id is null;

-- ── 3. Guard: a published or archived rota's shifts are immutable ────
create or replace function public.shifts_guard_immutable_rota()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rota_ids uuid[] := '{}';
  v_rota_id  uuid;
  v_status   text;
begin
  -- Server-side callers (retention, Edge Functions on service_role) have
  -- no end-user session. They are not the caller this guard is about.
  --
  -- `rotaflow.shift_transition` is the other exemption: a SECURITY DEFINER
  -- function that has already checked who is asking and what they are
  -- changing. Approving a shift swap is the case that needs it — both
  -- people have agreed and staff SHOULD see the new name immediately, so
  -- forcing it through an amendment would be wrong, not safer.
  if auth.uid() is null
     or coalesce(current_setting('rotaflow.shift_transition', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- An UPDATE that moves a shift between rotas has to satisfy the guard at
  -- both ends, so collect whichever rotas this row touches. NEW and OLD are
  -- read under an explicit TG_OP branch: referencing NEW in a DELETE (or OLD
  -- in an INSERT) is an error in plpgsql, not a null.
  if tg_op in ('INSERT', 'UPDATE') and new.rota_id is not null then
    v_rota_ids := array_append(v_rota_ids, new.rota_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.rota_id is not null then
    v_rota_ids := array_append(v_rota_ids, old.rota_id);
  end if;

  foreach v_rota_id in array v_rota_ids
  loop
    select status into v_status from public.rotas where id = v_rota_id;

    if v_status = 'published' then
      raise exception using
        errcode = 'ROTA1',
        message = 'This shift belongs to a published rota, which staff are already working to.',
        hint    = 'Start an amendment (begin_rota_revision) and edit that. Publishing the amendment replaces the published rota in one step.';
    elsif v_status = 'archived' then
      raise exception using
        errcode = 'ROTA2',
        message = 'This shift belongs to an archived rota, which is history and is never edited.',
        hint    = 'Edit the rota that superseded it.';
    end if;
  end loop;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists shifts_guard_immutable_rota on public.shifts;
create trigger shifts_guard_immutable_rota
  before insert or update or delete on public.shifts
  for each row execute function public.shifts_guard_immutable_rota();

-- ── 4. Guard: status changes only through the functions below ────────
-- The functions set `rotaflow.rota_transition` for the transaction, so a
-- direct PATCH of rotas.status from a browser or curl is refused while
-- every legitimate transition still works.
create or replace function public.rotas_guard_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null
     or coalesce(current_setting('rotaflow.rota_transition', true), '') = 'on' then
    return new;
  end if;

  -- INSERT: a rota is born a draft. Allowing a client to insert one already
  -- marked published would put a week in front of staff without ever passing
  -- through publish_rota, so it would carry no audit event and no
  -- published_by, and would sidestep the archive-the-previous-version step.
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception using
        errcode = 'ROTA3',
        message = 'A new rota starts as a draft.',
        hint    = 'Create it, then call publish_rota.';
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  raise exception using
    errcode = 'ROTA3',
    message = 'A rota status is changed by publishing, amending or unpublishing it, not by writing the column.',
    hint    = 'Call publish_rota, unpublish_rota, begin_rota_revision or discard_rota_revision.';
end;
$$;

drop trigger if exists rotas_guard_status_change on public.rotas;
create trigger rotas_guard_status_change
  before insert or update on public.rotas
  for each row execute function public.rotas_guard_status_change();

-- ── 5. begin_rota_revision ───────────────────────────────────────────
-- Idempotent by design: called twice it returns the same revision rather
-- than making a second one. Copies the published rota's shifts so the
-- manager starts from what staff can currently see, which is the whole
-- point of amending rather than starting an empty week.
create or replace function public.begin_rota_revision(p_rota_id uuid)
returns public.rotas language plpgsql security definer set search_path = public as $$
declare
  v_source   public.rotas;
  v_revision public.rotas;
  v_adopted  boolean := false;
begin
  select * into v_source from public.rotas where id = p_rota_id;
  if not found then
    raise exception using errcode = 'ROTA4', message = 'Rota not found.';
  end if;

  if not public.has_org_role(v_source.org_id, array['owner', 'manager']) then
    raise exception using
      errcode = '42501',
      message = 'Only an owner or manager can amend a rota.';
  end if;

  if v_source.status <> 'published' then
    raise exception using
      errcode = 'ROTA5',
      message = 'Only a published rota is amended. A draft is edited directly.';
  end if;

  -- Already amending? Hand back the same revision.
  select * into v_revision
    from public.rotas
   where supersedes_rota_id = p_rota_id and status = 'draft'
   limit 1;
  if found then
    return v_revision;
  end if;

  -- A draft may already exist for this scope from before 0059 — an empty
  -- orphan, or genuine unpublished work. Adopt it rather than colliding
  -- with rotas_draft_unique_*, and never discard its shifts.
  select * into v_revision
    from public.rotas
   where org_id = v_source.org_id
     and status = 'draft'
     and period_start = v_source.period_start
     and period_end   = v_source.period_end
     and location_id is not distinct from v_source.location_id
   limit 1;

  if found then
    v_adopted := true;
    perform set_config('rotaflow.rota_transition', 'on', true);
    update public.rotas
       set supersedes_rota_id = p_rota_id
     where id = v_revision.id
    returning * into v_revision;
    perform set_config('rotaflow.rota_transition', '', true);
  else
    insert into public.rotas (
      org_id, location_id, name, period_start, period_end,
      status, supersedes_rota_id, created_by)
    values (
      v_source.org_id, v_source.location_id, v_source.name,
      v_source.period_start, v_source.period_end,
      'draft', p_rota_id, auth.uid())
    returning * into v_revision;
  end if;

  -- Copy the published shifts in, unless the adopted draft already holds
  -- work of its own, which would be a manager's edits and is not ours to
  -- overwrite.
  if not exists (select 1 from public.shifts where rota_id = v_revision.id) then
    insert into public.shifts (
      org_id, rota_id, location_id, department_id, staff_profile_id,
      shift_type_id, starts_at, ends_at, break_minutes, status, colour, notes)
    select
      s.org_id, v_revision.id, s.location_id, s.department_id, s.staff_profile_id,
      s.shift_type_id, s.starts_at, s.ends_at, s.break_minutes, s.status, s.colour, s.notes
      from public.shifts s
     where s.rota_id = p_rota_id
       and s.status <> 'cancelled';
  end if;

  perform public.audit_write(
    v_source.org_id, 'rota.amendment_started', 'rota', v_revision.id,
    jsonb_strip_nulls(jsonb_build_object(
      'supersedes_rota_id', p_rota_id,
      'name',               v_revision.name,
      'period_start',       v_revision.period_start,
      'period_end',         v_revision.period_end,
      'location_id',        v_revision.location_id,
      'adopted_existing_draft', v_adopted)),
    'notice');

  return v_revision;
end;
$$;

-- ── 6. publish_rota ──────────────────────────────────────────────────
-- Publishing a revision archives the rota it supersedes in the same
-- transaction, so there is never a moment where staff see two versions of
-- a week or none of it.
create or replace function public.publish_rota(p_rota_id uuid)
returns public.rotas language plpgsql security definer set search_path = public as $$
declare
  v_rota      public.rotas;
  v_published public.rotas;
begin
  select * into v_rota from public.rotas where id = p_rota_id;
  if not found then
    raise exception using errcode = 'ROTA4', message = 'Rota not found.';
  end if;

  if not public.has_org_role(v_rota.org_id, array['owner', 'manager']) then
    raise exception using
      errcode = '42501', message = 'Only an owner or manager can publish a rota.';
  end if;

  if v_rota.status = 'published' then
    return v_rota;
  end if;
  if v_rota.status <> 'draft' then
    raise exception using
      errcode = 'ROTA6', message = 'Only a draft rota can be published.';
  end if;

  perform set_config('rotaflow.rota_transition', 'on', true);

  -- Archive the superseded original FIRST: rotas_published_unique_* would
  -- otherwise reject the new publication as a duplicate for the scope.
  if v_rota.supersedes_rota_id is not null then
    update public.rotas
       set status = 'archived', archived_at = timezone('utc', now())
     where id = v_rota.supersedes_rota_id
       and status = 'published';
  end if;

  update public.rotas
     set status = 'published',
         published_at = timezone('utc', now()),
         published_by = auth.uid(),
         supersedes_rota_id = v_rota.supersedes_rota_id
   where id = p_rota_id
  returning * into v_published;

  perform set_config('rotaflow.rota_transition', '', true);
  return v_published;
end;
$$;

-- ── 7. unpublish_rota ────────────────────────────────────────────────
-- Withdrawing a week from staff entirely. Distinct from amending it, and
-- refused while an amendment is open, because the draft index allows only
-- one draft per scope and silently discarding the manager's amendment to
-- make room would be the same class of bug this migration exists to fix.
create or replace function public.unpublish_rota(p_rota_id uuid)
returns public.rotas language plpgsql security definer set search_path = public as $$
declare
  v_rota public.rotas;
  v_out  public.rotas;
begin
  select * into v_rota from public.rotas where id = p_rota_id;
  if not found then
    raise exception using errcode = 'ROTA4', message = 'Rota not found.';
  end if;

  if not public.has_org_role(v_rota.org_id, array['owner', 'manager']) then
    raise exception using
      errcode = '42501', message = 'Only an owner or manager can unpublish a rota.';
  end if;

  if v_rota.status = 'draft' then
    return v_rota;
  end if;
  if v_rota.status <> 'published' then
    raise exception using
      errcode = 'ROTA7', message = 'Only a published rota can be unpublished.';
  end if;

  if exists (
    select 1 from public.rotas
     where supersedes_rota_id = p_rota_id and status = 'draft')
  then
    raise exception using
      errcode = 'ROTA8',
      message = 'This week has an open amendment.',
      hint    = 'Publish or discard the amendment first, then unpublish.';
  end if;

  perform set_config('rotaflow.rota_transition', 'on', true);
  update public.rotas
     set status = 'draft', published_at = null, published_by = null
   where id = p_rota_id
  returning * into v_out;
  perform set_config('rotaflow.rota_transition', '', true);

  return v_out;
end;
$$;

-- ── 8. discard_rota_revision ─────────────────────────────────────────
-- The way out of an amendment the manager no longer wants. Without it the
-- only escape from an open revision would be deleting rows by hand, which
-- is how BUG-029's one-way state came about in the first place.
create or replace function public.discard_rota_revision(p_rota_id uuid)
returns public.rotas language plpgsql security definer set search_path = public as $$
declare
  v_revision public.rotas;
  v_source   public.rotas;
  v_shifts   integer;
begin
  select * into v_revision from public.rotas where id = p_rota_id;
  if not found then
    raise exception using errcode = 'ROTA4', message = 'Rota not found.';
  end if;

  if not public.has_org_role(v_revision.org_id, array['owner', 'manager']) then
    raise exception using
      errcode = '42501', message = 'Only an owner or manager can discard an amendment.';
  end if;

  if v_revision.status <> 'draft' or v_revision.supersedes_rota_id is null then
    raise exception using
      errcode = 'ROTA9', message = 'That rota is not an open amendment.';
  end if;

  select count(*) into v_shifts from public.shifts where rota_id = p_rota_id;

  perform public.audit_write(
    v_revision.org_id, 'rota.amendment_discarded', 'rota', v_revision.id,
    jsonb_build_object(
      'supersedes_rota_id', v_revision.supersedes_rota_id,
      'discarded_shifts',   v_shifts),
    'warning');

  delete from public.shifts where rota_id = p_rota_id;
  delete from public.rotas  where id = p_rota_id;

  select * into v_source from public.rotas where id = v_revision.supersedes_rota_id;
  return v_source;
end;
$$;

-- ── 9. Audit the whole lifecycle, deletion included ──────────────────
-- BUG-035: a rota could disappear with no audit record at all, which made
-- a production disappearance impossible to attribute. 0016 audited only
-- `after update`, and only the status column.
create or replace function public.audit_rota_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_action text;
begin
  if tg_op = 'DELETE' then
    perform public.audit_write(
      old.org_id, 'rota.deleted', 'rota', old.id,
      jsonb_strip_nulls(jsonb_build_object(
        'name',         old.name,
        'status',       old.status,
        'period_start', old.period_start,
        'period_end',   old.period_end,
        'location_id',  old.location_id,
        'shift_count',  (select count(*) from public.shifts s where s.rota_id = old.id))),
      case when old.status = 'published' then 'warning' else 'notice' end);
    return null;
  end if;

  if new.status is not distinct from old.status then
    return null;
  end if;

  v_action := case
    when new.status = 'published' and old.supersedes_rota_id is not null
      then 'rota.republished'
    when new.status = 'published' then 'rota.published'
    when new.status = 'archived'  then 'rota.superseded'
    else 'rota.unpublished'
  end;

  perform public.audit_write(
    new.org_id, v_action, 'rota', new.id,
    jsonb_strip_nulls(jsonb_build_object(
      'name',               new.name,
      'period_start',       new.period_start,
      'period_end',         new.period_end,
      'location_id',        new.location_id,
      'from_status',        old.status,
      'to_status',          new.status,
      'supersedes_rota_id', new.supersedes_rota_id)),
    'notice');
  return null;
end;
$$;

drop trigger if exists rotas_audit on public.rotas;
create trigger rotas_audit
  after update or delete on public.rotas
  for each row execute function public.audit_rota_status();

-- ── 9b. The one legitimate edit to a published rota ──────────────────
-- Approving a swap reassigns a published shift, and that is correct: two
-- people have agreed and a manager (or, under 0043, the requester) has
-- approved it. Staff should see the new name straight away rather than
-- waiting for a manager to amend and republish the week.
--
-- It is still not a free-for-all. This function is the only route through
-- `shifts_guard_immutable_rota` that an end user can take, it changes
-- exactly one column, and it audits the change — which the previous
-- client-side `updateShift` call did not, so a swapped shift used to leave
-- no trace on the rota at all.
create or replace function public.apply_swap_reassignment(p_swap_id uuid)
returns public.shifts language plpgsql security definer set search_path = public as $$
declare
  v_swap  public.shift_swaps;
  v_shift public.shifts;
begin
  select * into v_swap from public.shift_swaps where id = p_swap_id;
  if not found then
    raise exception using errcode = 'SWAP1', message = 'Swap not found.';
  end if;

  if v_swap.status <> 'approved' then
    raise exception using
      errcode = 'SWAP2', message = 'Only an approved swap reassigns its shift.';
  end if;

  if v_swap.target_staff_profile_id is null then
    raise exception using
      errcode = 'SWAP3',
      message = 'This swap has nobody to reassign the shift to.',
      hint    = 'An open swap nobody claimed is approved without a target; assign it in the Rota Builder.';
  end if;

  -- Who may do this mirrors who may finalize the swap (0002's
  -- shift_swaps_write and 0043's shift_swaps_requester_finalize): a
  -- manager or owner, or the requester of a swap their colleague accepted.
  if not (
    public.has_org_role(v_swap.org_id, array['owner', 'manager'])
    or v_swap.requested_by = public.my_staff_profile_id(v_swap.org_id)
  ) then
    raise exception using
      errcode = '42501', message = 'Not allowed to reassign this shift.';
  end if;

  perform set_config('rotaflow.shift_transition', 'on', true);
  update public.shifts
     set staff_profile_id = v_swap.target_staff_profile_id,
         status = 'assigned'
   where id = v_swap.shift_id
  returning * into v_shift;
  perform set_config('rotaflow.shift_transition', '', true);

  if not found then
    raise exception using errcode = 'SWAP4', message = 'The shift in this swap no longer exists.';
  end if;

  perform public.audit_write(
    v_swap.org_id, 'rota.shift_reassigned', 'shift', v_shift.id,
    jsonb_strip_nulls(jsonb_build_object(
      'swap_id',      p_swap_id,
      'rota_id',      v_shift.rota_id,
      'from_staff_profile_id', v_swap.requested_by,
      'to_staff_profile_id',   v_swap.target_staff_profile_id,
      'starts_at',    v_shift.starts_at)),
    'notice');

  return v_shift;
end;
$$;

-- ── 10. Grants ───────────────────────────────────────────────────────
revoke all on function public.begin_rota_revision(uuid)   from public, anon;
revoke all on function public.publish_rota(uuid)          from public, anon;
revoke all on function public.unpublish_rota(uuid)        from public, anon;
revoke all on function public.discard_rota_revision(uuid) from public, anon;
revoke all on function public.apply_swap_reassignment(uuid) from public, anon;

grant execute on function public.begin_rota_revision(uuid)   to authenticated;
grant execute on function public.publish_rota(uuid)          to authenticated;
grant execute on function public.unpublish_rota(uuid)        to authenticated;
grant execute on function public.discard_rota_revision(uuid) to authenticated;
grant execute on function public.apply_swap_reassignment(uuid) to authenticated;
