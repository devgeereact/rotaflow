-- =====================================================================
-- 0123 · A swap decision is one transaction
--
-- Closes the 5 September 2026 audit's RF-02 and RF-03.
--
-- RF-02. `decideShiftSwap` used to make two round trips: PATCH the swap to
-- 'approved', then call `apply_swap_reassignment`. Those are two
-- transactions. Anything between them — a dropped connection, a closed
-- laptop, a 500 — left the swap approved and the shift still on the
-- original person. Worse, `enqueue_swap_reviewed_notification` fires on the
-- status change, so the requester was told "your swap was approved" for a
-- shift that had not moved. The client caught the second failure and asked
-- the manager to move it by hand, which is a recovery procedure, not
-- transactional correctness: nothing made them do it, and nothing noticed
-- if they did not.
--
-- RF-03. `apply_swap_reassignment` read an approved swap without a row
-- lock, kept no record that it had already run, and updated the shift by id
-- with no predicate on who was currently holding it. So an approved swap
-- stayed a *reusable command*. Approve A→B and apply it; later B legitimately
-- passes the shift to C; re-invoke the first RPC and C is silently
-- overwritten by B. It also did not refuse an archived rota, which 0061
-- otherwise treats as immutable history.
--
-- The fix is one SECURITY DEFINER function that does the whole decision
-- under a row lock, and immutable evidence that the reassignment was
-- consumed. Because it is one function it is one transaction: a failure at
-- the reassignment step rolls the approval and its outbox row back with it,
-- so "approved" and "reassigned" can no longer disagree.
--
-- `apply_swap_reassignment` is kept — 0113 grants it, and an older client
-- bundle may still be in someone's service worker cache — but it is
-- hardened with the same guards and now refuses a second application
-- instead of performing one.
--
-- SAFETY(additive): adds three nullable columns and replaces two functions.
-- No column is dropped, no row is deleted, and no existing swap changes
-- state. Existing approved swaps have `applied_at` null, which reads as
-- "never applied through the guarded path" — the honest answer, since the
-- old path recorded nothing. The backfill below claims only what the audit
-- log can prove.
-- =====================================================================

-- ── 1. Evidence that a reassignment was consumed ─────────────────────
alter table public.shift_swaps
  add column if not exists applied_at        timestamptz,
  add column if not exists applied_shift_id  uuid references public.shifts(id) on delete set null,
  add column if not exists applied_from_staff_profile_id uuid
    references public.staff_profiles(id) on delete set null;

comment on column public.shift_swaps.applied_at is
  'When this swap actually moved its shift. Set once, by decide_shift_swap. A swap with applied_at set is spent: re-invoking the reassignment returns the recorded result and changes nothing. Null on a swap approved before 0123, and on an approved open swap nobody claimed.';
comment on column public.shift_swaps.applied_shift_id is
  'The shift this swap moved. Recorded separately from shift_id so a later edit of the swap cannot rewrite what was actually done.';
comment on column public.shift_swaps.applied_from_staff_profile_id is
  'Who held the shift at the moment it moved. The reassignment is only valid while this is still the holder, which is what stops a stale approved swap reverting a later legitimate transfer.';

-- Backfill from `audit_logs`, which is append-only (0016's
-- audit_logs_immutable trigger) and is therefore the one trustworthy record
-- of what the old two-step path actually did. A swap with no
-- 'rota.shift_reassigned' event never reassigned anything, and is
-- deliberately left null rather than assumed.
--
-- `metadata ->> 'swap_id'` is cast inside a guarded subquery rather than in
-- the join predicate: `metadata` is free-form jsonb written by several
-- callers, and one row whose `swap_id` is not a uuid would fail the whole
-- migration on a cast Postgres is free to evaluate before the action filter.
update public.shift_swaps s
   set applied_at = a.created_at,
       applied_shift_id = s.shift_id,
       applied_from_staff_profile_id = s.requested_by
  from (
    select created_at, (metadata ->> 'swap_id')::uuid as swap_id
      from public.audit_logs
     where action = 'rota.shift_reassigned'
       and metadata ->> 'swap_id' ~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ) a
 where a.swap_id = s.id
   and s.applied_at is null;

-- ── 2. The whole decision, in one transaction ────────────────────────
create or replace function public.decide_shift_swap(
  p_swap_id uuid,
  p_status  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_swap        public.shift_swaps;
  v_shift       public.shifts;
  v_rota_status text;
  v_target      public.staff_profiles;
  v_actor       uuid := auth.uid();
begin
  if p_status not in ('approved', 'rejected') then
    raise exception using
      errcode = 'SWAP7',
      message = 'A swap decision is either approved or rejected.';
  end if;

  -- FOR UPDATE, not a bare select. Two managers deciding the same swap at
  -- the same moment serialise here; the second one finds it already decided
  -- rather than both reading 'pending' and both proceeding.
  select * into v_swap
    from public.shift_swaps
   where id = p_swap_id
     for update;

  if not found then
    raise exception using errcode = 'SWAP1', message = 'Swap not found.';
  end if;

  -- Already settled. Return what was recorded rather than raising: a retry
  -- after a lost response must be able to learn the outcome without a second
  -- decision being possible. This is the idempotent read of the same call.
  if v_swap.status not in ('pending', 'accepted') then
    return jsonb_build_object(
      'outcome',            'already-decided',
      'status',             v_swap.status,
      'reassigned',         v_swap.applied_at is not null,
      'applied_at',         v_swap.applied_at,
      'shift_id',           v_swap.applied_shift_id,
      'target_staff_profile_id', v_swap.target_staff_profile_id);
  end if;

  -- Who may decide, unchanged from the RLS policies this replaces: a
  -- manager or owner on any swap, or the requester on one their named
  -- colleague has already accepted (0043). Derived from auth.uid() here,
  -- never from a client-supplied reviewer id — the old service passed
  -- `user.id` from the browser, which the row policy happened to constrain
  -- but the RPC would not have.
  if not (
    public.has_org_role(v_swap.org_id, array['owner', 'manager'])
    or (v_swap.status = 'accepted'
        and v_swap.requested_by = public.my_staff_profile_id(v_swap.org_id))
  ) then
    raise exception using
      errcode = '42501', message = 'Not allowed to decide this swap.';
  end if;

  if p_status = 'rejected' then
    update public.shift_swaps
       set status = 'rejected', reviewed_by = v_actor, reviewed_at = now()
     where id = p_swap_id;
    return jsonb_build_object('outcome', 'declined');
  end if;

  update public.shift_swaps
     set status = 'approved', reviewed_by = v_actor, reviewed_at = now()
   where id = p_swap_id;

  -- An open offer nobody claimed is approved without a transfer. It must not
  -- claim one: the manager assigns the shift in the builder.
  if v_swap.shift_id is null or v_swap.target_staff_profile_id is null then
    return jsonb_build_object(
      'outcome', 'approved', 'reassigned', false, 'reason', 'no-target');
  end if;

  select * into v_shift
    from public.shifts
   where id = v_swap.shift_id
     for update;

  if not found then
    raise exception using
      errcode = 'SWAP4', message = 'The shift in this swap no longer exists.';
  end if;

  -- 0061 treats an archived rota as history that is never edited again. A
  -- swap raised before an amendment was published must not reach back into
  -- the version it superseded.
  if v_shift.rota_id is not null then
    select status into v_rota_status from public.rotas where id = v_shift.rota_id;
    if v_rota_status = 'archived' then
      raise exception using
        errcode = 'SWAP5',
        message = 'This shift is on an archived rota and cannot be reassigned.',
        hint    = 'The rota was replaced by an amendment. Raise the swap against the current version.';
    end if;
  end if;

  -- The reassignment is only meaningful while the requester still holds the
  -- shift. If somebody else already has it, approving this swap would take
  -- it off them without their knowledge.
  if v_shift.staff_profile_id is distinct from v_swap.requested_by then
    raise exception using
      errcode = 'SWAP6',
      message = 'This shift is no longer assigned to the person who offered it.',
      hint    = 'Somebody else has taken it since the swap was raised. Nothing was changed.';
  end if;

  select * into v_target
    from public.staff_profiles
   where id = v_swap.target_staff_profile_id;

  if not found or v_target.org_id <> v_swap.org_id or not v_target.active then
    raise exception using
      errcode = 'SWAP8',
      message = 'The person taking this shift is no longer an active member of this organisation.';
  end if;

  perform set_config('rotaflow.shift_transition', 'on', true);
  update public.shifts
     set staff_profile_id = v_swap.target_staff_profile_id,
         status = 'assigned'
   where id = v_swap.shift_id
  returning * into v_shift;
  perform set_config('rotaflow.shift_transition', '', true);

  -- Spend the swap. `applied_at is null` in the predicate is what makes a
  -- concurrent second application lose rather than both succeed.
  update public.shift_swaps
     set applied_at = now(),
         applied_shift_id = v_shift.id,
         applied_from_staff_profile_id = v_swap.requested_by
   where id = p_swap_id
     and applied_at is null;

  if not found then
    raise exception using
      errcode = 'SWAP9',
      message = 'This swap has already moved its shift.';
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

  return jsonb_build_object(
    'outcome', 'approved', 'reassigned', true, 'shift_id', v_shift.id);
end;
$$;

comment on function public.decide_shift_swap(uuid, text) is
  'The whole swap decision in one transaction: lock, authorise, record the decision, verify the shift is still the requester''s and its rota still live, move it, and spend the swap. Replaces the client sequence of reviewShiftSwap + apply_swap_reassignment, which could leave an approved swap whose shift never moved (RF-02).';

-- ── 3. Harden the legacy entry point ─────────────────────────────────
-- Kept for an older client bundle still in a service worker cache. It now
-- refuses everything the new path refuses, and refuses a second application
-- outright rather than performing one.
create or replace function public.apply_swap_reassignment(p_swap_id uuid)
returns public.shifts language plpgsql security definer set search_path = public as $$
declare
  v_swap        public.shift_swaps;
  v_shift       public.shifts;
  v_rota_status text;
  v_target      public.staff_profiles;
begin
  select * into v_swap
    from public.shift_swaps
   where id = p_swap_id
     for update;

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

  -- RF-03. An approved swap is not a standing command. Once it has moved its
  -- shift it is spent, and replaying it must not reach into whatever
  -- happened afterwards.
  if v_swap.applied_at is not null then
    raise exception using
      errcode = 'SWAP9',
      message = 'This swap has already moved its shift.',
      hint    = 'Raise a new swap to move it again.';
  end if;

  if not (
    public.has_org_role(v_swap.org_id, array['owner', 'manager'])
    or v_swap.requested_by = public.my_staff_profile_id(v_swap.org_id)
  ) then
    raise exception using
      errcode = '42501', message = 'Not allowed to reassign this shift.';
  end if;

  select * into v_shift
    from public.shifts
   where id = v_swap.shift_id
     for update;

  if not found then
    raise exception using errcode = 'SWAP4', message = 'The shift in this swap no longer exists.';
  end if;

  if v_shift.rota_id is not null then
    select status into v_rota_status from public.rotas where id = v_shift.rota_id;
    if v_rota_status = 'archived' then
      raise exception using
        errcode = 'SWAP5',
        message = 'This shift is on an archived rota and cannot be reassigned.';
    end if;
  end if;

  if v_shift.staff_profile_id is distinct from v_swap.requested_by then
    raise exception using
      errcode = 'SWAP6',
      message = 'This shift is no longer assigned to the person who offered it.';
  end if;

  select * into v_target
    from public.staff_profiles
   where id = v_swap.target_staff_profile_id;

  if not found or v_target.org_id <> v_swap.org_id or not v_target.active then
    raise exception using
      errcode = 'SWAP8',
      message = 'The person taking this shift is no longer an active member of this organisation.';
  end if;

  perform set_config('rotaflow.shift_transition', 'on', true);
  update public.shifts
     set staff_profile_id = v_swap.target_staff_profile_id,
         status = 'assigned'
   where id = v_swap.shift_id
  returning * into v_shift;
  perform set_config('rotaflow.shift_transition', '', true);

  update public.shift_swaps
     set applied_at = now(),
         applied_shift_id = v_shift.id,
         applied_from_staff_profile_id = v_swap.requested_by
   where id = p_swap_id
     and applied_at is null;

  if not found then
    raise exception using
      errcode = 'SWAP9', message = 'This swap has already moved its shift.';
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

-- ── 4. Grants ────────────────────────────────────────────────────────
-- Explicit, for the reason 0113 exists: production grants EXECUTE to
-- `authenticated` through a default ACL the local image does not have, so a
-- database rebuilt from this history refuses the call unless it is written
-- down here.
revoke all on function public.decide_shift_swap(uuid, text) from public, anon;
grant execute on function public.decide_shift_swap(uuid, text) to authenticated;
revoke all on function public.apply_swap_reassignment(uuid) from public, anon;
grant execute on function public.apply_swap_reassignment(uuid) to authenticated;
