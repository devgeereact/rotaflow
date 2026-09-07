-- =====================================================================
-- 0124 · One timesheet decision per person, per period
--
-- Closes the 5 September 2026 audit's RF-07.
--
-- `timesheets` has carried no unique key on (org, staff, period) since
-- 0002, and `approveTimesheets` compensated in the client: read the rows
-- that already exist, insert the ones that do not, update the ones that do.
-- That is a read-then-write with no lock over it, so two managers approving
-- the same week both read "no row yet" and both insert. The audit
-- reproduced it against the local database in a rolled-back transaction:
-- two `approved` rows for the same staff member and week, one saying 480
-- minutes and the other 420, and no error. `listTimesheets` then returns
-- both and whichever the screen picks is arbitrary.
--
-- The batch had a second failure mode of its own. The inserts went in one
-- statement and the updates in a loop of separate ones, so a failure part
-- way through a twenty-person approval left some people signed off and
-- others not, with the manager shown one error and no way to tell which was
-- which.
--
-- The fix is the constraint the table should always have had, plus one
-- server-side operation that does the whole batch under it. Because the
-- function is one statement from the caller's point of view, a failure on
-- person seventeen rolls back the first sixteen: the batch is atomic, which
-- is what a payroll sign-off has to be.
--
-- Evidence columns are added at the same time. A sign-off that does not
-- record who made it, when, and against what figure is not a sign-off.
--
-- SAFETY(additive-with-guard): adds three nullable columns, one unique
-- index and one function. No row is deleted and no value is overwritten.
--
-- The unique index cannot be created while conflicting rows exist, and this
-- migration deliberately does NOT pick a winner: choosing between two
-- disagreeing payroll totals by `updated_at` is a decision about somebody's
-- pay, not a data migration. If duplicates are present it raises with the
-- query to review them. Verified against the live project on 5 September
-- 2026: 0 timesheets, 0 duplicate groups, so there is nothing to resolve.
-- =====================================================================

-- ── 1. Make any conflict visible before refusing it ──────────────────
create or replace view public.timesheet_approval_conflicts as
  select org_id,
         staff_profile_id,
         period_start,
         period_end,
         count(*)                       as decision_count,
         array_agg(id order by created_at)            as timesheet_ids,
         array_agg(total_minutes order by created_at) as total_minutes_each,
         array_agg(status order by created_at)        as status_each
    from public.timesheets
   group by org_id, staff_profile_id, period_start, period_end
  having count(*) > 1;

comment on view public.timesheet_approval_conflicts is
  'Periods holding more than one timesheet row for the same person. Empty is the only correct state since 0124. A row here is two disagreeing sign-offs for one week and needs a human decision, not a delete.';

-- The view inherits the base table's RLS, so this grant does not widen
-- anything: a member sees only conflicts inside their own organisation.
revoke all on public.timesheet_approval_conflicts from public, anon;
grant select on public.timesheet_approval_conflicts to authenticated, service_role;

do $$
declare
  v_conflicts integer;
begin
  select count(*) into v_conflicts from public.timesheet_approval_conflicts;
  if v_conflicts > 0 then
    raise exception using
      errcode = 'TS001',
      message = format(
        '%s period(s) hold more than one timesheet decision. Refusing to add the unique key until they are reconciled.',
        v_conflicts),
      hint = 'Review them with: select * from public.timesheet_approval_conflicts; then keep one row per period by explicit decision. Do not resolve this by deleting the newer or older row automatically — the two rows disagree about somebody''s hours.';
  end if;
end;
$$;

-- ── 2. The key the table should have had ─────────────────────────────
create unique index if not exists timesheets_period_unique
  on public.timesheets (org_id, staff_profile_id, period_start, period_end);

comment on index public.timesheets_period_unique is
  'One sign-off decision per person per period. Without it, two managers approving the same week each inserted a row and payroll read whichever came back first (RF-07).';

-- ── 3. Evidence ──────────────────────────────────────────────────────
alter table public.timesheets
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists version integer not null default 0;

comment on column public.timesheets.approved_by is
  'Who signed this period off. auth.users, not staff_profiles: the approver is an account acting in a role, and may not have a staff record of their own.';
comment on column public.timesheets.approved_at is
  'When the sign-off was made. Distinct from updated_at, which moves for any edit.';
comment on column public.timesheets.version is
  'Incremented on every approval. A period re-approved after a clock correction is a second decision, and the count is what makes that visible rather than looking like the first one always said this.';

-- ── 4. One transactional approval ────────────────────────────────────
-- `p_approvals` is [{"staff_profile_id": uuid, "total_minutes": int}, ...].
-- jsonb rather than a composite type so the client sends plain JSON and no
-- generated type has to be hand-maintained for a parameter shape.
create or replace function public.approve_timesheets(
  p_org          uuid,
  p_period_start date,
  p_period_end   date,
  p_approvals    jsonb
)
returns setof public.timesheets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if not public.has_org_role(p_org, array['owner', 'manager']) then
    raise exception using
      errcode = '42501', message = 'Only an owner or manager approves a timesheet.';
  end if;

  if jsonb_typeof(p_approvals) <> 'array' then
    raise exception using
      errcode = 'TS002', message = 'Approvals must be an array.';
  end if;

  if p_period_end < p_period_start then
    raise exception using
      errcode = 'TS003', message = 'A period cannot end before it starts.';
  end if;

  -- One statement for the whole batch. `on conflict` is what the unique
  -- index above makes possible, and it is also what makes a concurrent
  -- second approver update the same row rather than insert a second one.
  --
  -- A person from another organisation is filtered out by the join rather
  -- than trusted from the payload: the caller is a manager of p_org, and the
  -- only staff they may sign off are p_org's own.
  return query
  insert into public.timesheets as t (
    org_id, staff_profile_id, period_start, period_end,
    total_minutes, status, approved_by, approved_at, version)
  select p_org,
         sp.id,
         p_period_start,
         p_period_end,
         (a ->> 'total_minutes')::integer,
         'approved',
         v_actor,
         now(),
         1
    from jsonb_array_elements(p_approvals) as a
    join public.staff_profiles sp
      on sp.id = (a ->> 'staff_profile_id')::uuid
     and sp.org_id = p_org
  on conflict (org_id, staff_profile_id, period_start, period_end)
  do update set
       total_minutes = excluded.total_minutes,
       status        = 'approved',
       approved_by   = excluded.approved_by,
       approved_at   = excluded.approved_at,
       -- Re-approving a period after a clock correction is a NEW decision,
       -- and the count is the only thing that says so. `total_minutes` is
       -- still a snapshot of what was agreed, deliberately not kept in step
       -- with the derived figure afterwards.
       version       = t.version + 1,
       updated_at    = now()
  returning t.*;
end;
$$;

comment on function public.approve_timesheets(uuid, date, date, jsonb) is
  'Approve a period for several people in one transaction. Replaces the client read-then-insert-or-update, which could create two conflicting decisions for one week and could leave a batch half applied (RF-07).';

revoke all on function public.approve_timesheets(uuid, date, date, jsonb) from public, anon;
grant execute on function public.approve_timesheets(uuid, date, date, jsonb) to authenticated;
