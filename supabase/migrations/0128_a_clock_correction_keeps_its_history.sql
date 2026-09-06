-- =====================================================================
-- 0128 · A clock correction keeps its history, and cannot silently
--        rewrite a signed-off timesheet
--
-- `updateClockEvent` writes straight over `clock_events`. RLS restricts it
-- to an owner or a manager, which is right, and that is the whole of the
-- control: no reason is recorded, the previous value is gone, two managers
-- editing the same row at the same time each believe they won, and
-- `clockService` itself says so — "there is no separate history/audit
-- column on `clock_events` for that, so `updated_at` is the only trace
-- that a correction happened".
--
-- These events become somebody's pay. A pay record that can be altered
-- with no reason, no author and no prior value is not an attendance
-- record, it is a number.
--
-- ## What this adds
--
--   1. `clock_event_corrections`, append-only. Before and after as jsonb,
--      the reason, the actor's id AND their name at the time, and when.
--   2. `correct_clock_event`, the only writer. Checks the role, demands a
--      reason, refuses a stale write, records the history and applies the
--      change in one transaction.
--   3. `timesheets.recalculation_required_at`, so a correction landing on
--      a period that has already been approved marks it for a fresh
--      decision instead of quietly changing what somebody signed.
--
-- ## Why the approved total is not recalculated here
--
-- `0124` made `timesheets.total_minutes` a snapshot of what was agreed,
-- deliberately not kept in step with the derived figure. That is the right
-- shape: an approval is a decision by a person, and a trigger that moved
-- the number afterwards would rewrite that decision without anybody
-- deciding anything. So a correction flags the period and the manager
-- re-approves through `approve_timesheets`, which increments `version` and
-- makes the second decision visible as a second decision.
--
-- ## Why the direct UPDATE grant goes
--
-- Leaving both paths open would make the audited one optional, and an
-- optional audit trail records only the corrections nobody minded being
-- seen. `clock_events_update` is narrowed to the definer function.
--
-- SAFETY(revoke): the UPDATE privilege on `clock_events` is withdrawn from
-- `authenticated`. Nothing is deleted and no row changes. The capability
-- is preserved through `correct_clock_event`, which applies the same role
-- check the policy did — this narrows *how* a correction is made, not who
-- may make one. The client in this same change set calls the function.
-- SAFETY(create_policy): the new table's read policy is owner/manager
-- scoped in the same shape as every other management table, and it has no
-- write policy at all: only the SECURITY DEFINER function writes it, which
-- is what makes the history append-only.
-- =====================================================================

create table if not exists public.clock_event_corrections (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organisations(id) on delete cascade,
  clock_event_id   uuid not null references public.clock_events(id) on delete cascade,
  staff_profile_id uuid not null references public.staff_profiles(id) on delete cascade,

  -- The actor's id AND their name at the time, for the reason 0016 gives:
  -- an audit record should say who acted then, not who that account
  -- happens to be now, and a join to `profiles` resolves to null for
  -- everyone but the reader.
  actor_user_id    uuid references auth.users(id) on delete set null,
  actor_name       text,

  reason           text not null check (length(btrim(reason)) between 3 and 500),

  -- The whole row either side, so a future column is covered without a
  -- migration and so the record stays readable if the table changes shape.
  before_value     jsonb not null,
  after_value      jsonb not null,

  created_at       timestamptz not null default timezone('utc', now())
);

comment on table public.clock_event_corrections is
  'Append-only history of manual changes to clock_events. Written only by correct_clock_event; no client may insert, update or delete a row here. This is the immutable half of an attendance record — the events themselves are mutable by design, so the evidence that they changed has to live somewhere that is not.';

create index if not exists clock_event_corrections_event_idx
  on public.clock_event_corrections (clock_event_id, created_at desc);
create index if not exists clock_event_corrections_org_idx
  on public.clock_event_corrections (org_id, created_at desc);

alter table public.clock_event_corrections enable row level security;

drop policy if exists clock_event_corrections_select on public.clock_event_corrections;
create policy clock_event_corrections_select
  on public.clock_event_corrections for select
  using (public.has_org_role(org_id, array['owner','manager']));

-- SELECT only. There is deliberately no insert/update/delete policy and the
-- write privileges are taken away below: the definer function is the only
-- writer, which is what makes "append-only" a property of the schema rather
-- than a promise.
--
-- The revoke is not belt and braces. The Supabase image ships a **default
-- ACL** granting every privilege on a new `public` table to `authenticated`
-- (`pg_default_acl`), so a `grant select` adds nothing — the role already
-- holds INSERT, UPDATE, DELETE and TRUNCATE the moment the table exists. RLS
-- with no write policy would still refuse the writes, but TRUNCATE is not
-- subject to RLS at all, so an append-only history would be one statement
-- away from empty. `0075` swept the tables that existed then; a table created
-- afterwards gets the grants back, which is the same trap `0112` documents
-- for functions.
revoke all on public.clock_event_corrections from authenticated;
grant select on public.clock_event_corrections to authenticated;

-- ── the period flag ──────────────────────────────────────────────────
alter table public.timesheets
  add column if not exists recalculation_required_at timestamptz;

comment on column public.timesheets.recalculation_required_at is
  'Set when a clock correction lands inside an already-approved or exported period. total_minutes is NOT changed — it is the snapshot of what a person signed off (0124) — so this is the flag that asks for a fresh decision through approve_timesheets.';

-- ── the only writer ──────────────────────────────────────────────────
create or replace function public.correct_clock_event(
  p_event                uuid,
  p_reason               text,
  p_event_at             timestamptz default null,
  p_type                 text default null,
  p_expected_updated_at  timestamptz default null
)
returns public.clock_events
language plpgsql security definer set search_path = public as $$
declare
  v_actor  uuid := auth.uid();
  v_before public.clock_events;
  v_after  public.clock_events;
  v_name   text;
  v_date   date;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_before from public.clock_events where id = p_event;
  if not found then
    raise exception 'Clock event not found' using errcode = 'CLK03';
  end if;

  -- SECURITY DEFINER bypasses RLS, so the role check is explicit. Same
  -- roles the policy this replaces admitted.
  if not public.has_org_role(v_before.org_id, array['owner','manager']) then
    raise exception 'Only an owner or manager can correct an attendance record'
      using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A correction needs a reason.' using errcode = 'CLK04';
  end if;

  -- Optimistic concurrency. Two managers opening the same row and both
  -- saving used to mean the second silently discarded the first, with the
  -- history showing one change. The caller sends the `updated_at` it read;
  -- a mismatch is refused so the second person re-reads and decides again.
  -- Callers that pass null opt out, which is why the client always sends it.
  if p_expected_updated_at is not null
     and v_before.updated_at is distinct from p_expected_updated_at then
    raise exception 'This attendance record changed while you were editing it. Reopen it and try again.'
      using errcode = 'CLK05';
  end if;

  if p_type is not null and p_type not in ('in','out','break_start','break_end') then
    raise exception 'Unknown clock event type: %', p_type using errcode = 'CLK06';
  end if;

  update public.clock_events
     set event_at = coalesce(p_event_at, event_at),
         type     = coalesce(p_type, type)
   where id = p_event
  returning * into v_after;

  select coalesce(p.full_name, p.email) into v_name
    from public.profiles p where p.id = v_actor;

  insert into public.clock_event_corrections (
    org_id, clock_event_id, staff_profile_id,
    actor_user_id, actor_name, reason, before_value, after_value)
  values (
    v_before.org_id, v_before.id, v_before.staff_profile_id,
    v_actor, v_name, btrim(p_reason), to_jsonb(v_before), to_jsonb(v_after));

  -- A correction can move an event across a day boundary, so both the old
  -- and the new date are checked: the period it left needs re-approving
  -- just as much as the one it joined.
  for v_date in
    select distinct d from unnest(array[
      (v_before.event_at at time zone 'UTC')::date,
      (v_after.event_at  at time zone 'UTC')::date
    ]) as d
  loop
    update public.timesheets
       set recalculation_required_at = now()
     where org_id = v_before.org_id
       and staff_profile_id = v_before.staff_profile_id
       and status in ('approved','exported')
       and v_date between period_start and period_end;
  end loop;

  return v_after;
end;
$$;

comment on function public.correct_clock_event(uuid, text, timestamptz, text, timestamptz) is
  'The only way to change a clock event. Records who, why, and the row either side; refuses a stale write; flags an already-approved timesheet for a fresh decision rather than moving the total somebody signed.';

revoke all on function public.correct_clock_event(uuid, text, timestamptz, text, timestamptz)
  from public, anon;
grant execute on function public.correct_clock_event(uuid, text, timestamptz, text, timestamptz)
  to authenticated;

-- ── close the unaudited path ─────────────────────────────────────────
-- The policy is dropped and the privilege withdrawn together. Either one
-- alone leaves the other as the effective control, and an audit trail with
-- a documented bypass beside it is not an audit trail.
drop policy if exists clock_events_update on public.clock_events;
revoke update on public.clock_events from authenticated;
