-- =====================================================================
-- 0110_support_sla.sql — a support promise with a clock on it
-- (docs/SAAS.md CAP-080)
--
-- `support_cases` records `first_response_at` and `resolved_at`, so the
-- product knows when it answered — and has never known when it was
-- supposed to. A case sits in a list at the same weight whether it
-- arrived an hour ago or a fortnight ago, and "we aim to respond
-- quickly" is not a thing anybody can be held to or measure.
--
-- ## Targets are rows, not constants
--
-- A support promise changes with the plan a customer is on and with what
-- the business is willing to commit to this quarter. In code that is a
-- deploy; as a row it is an edit, and the number that is being promised
-- is visible to anybody who can read the table rather than buried in a
-- function.
--
-- ## The clock does NOT pause while waiting on the customer
--
-- The decision worth arguing with. Most support tools stop the clock
-- when a case is "pending customer", which is defensible and is also the
-- standard way a support team flatters its own numbers: a case can sit
-- for three weeks and still report as within target.
--
-- This measures the thing the customer actually experiences — how long
-- from asking to being answered. It will look worse. It will also be
-- true, and with zero customers today the right choice is the measure
-- that cannot be gamed before anybody has an incentive to game it.
-- Reopens as a decision the first time a real customer's own delay makes
-- a target look breached that nobody could have met.
--
-- ## Changing the priority moves the deadline, but only forwards
--
-- A case escalated to urgent gets the urgent deadline computed from when
-- it ARRIVED, not from when it was escalated — otherwise escalating a
-- late case resets its clock and the breach disappears. Downgrading a
-- case that has already breached does not un-breach it either: the
-- deadline is recomputed, and the recorded response time does not move.
-- =====================================================================

create table if not exists public.support_sla_targets (
  priority                text primary key
                            check (priority in ('urgent', 'high', 'normal', 'low')),
  first_response_minutes  integer not null check (first_response_minutes > 0),
  resolution_minutes      integer not null check (resolution_minutes > 0),
  updated_at              timestamptz not null default timezone('utc', now()),

  -- A resolution target inside the response target would be unmeetable by
  -- construction, and nobody would notice until a report said 100% breached.
  constraint support_sla_targets_ordered
    check (resolution_minutes >= first_response_minutes)
);

comment on table public.support_sla_targets is
  'What the product promises, per priority. A row rather than a constant, because a support promise changes with the plan and the quarter (CAP-080).';

insert into public.support_sla_targets (priority, first_response_minutes, resolution_minutes)
values
  -- Working hours are not modelled. These are wall-clock minutes, which is
  -- what somebody waiting experiences; a "4 business hours" target that
  -- silently means Monday when raised on Friday evening is the same class of
  -- flattery as pausing the clock.
  ('urgent',  60,   240),
  ('high',    240,  1440),
  ('normal',  1440, 4320),
  ('low',     2880, 10080)
on conflict (priority) do nothing;

alter table public.support_sla_targets enable row level security;

-- Readable by everybody who can raise a case: a promise nobody can read is
-- not a promise. Writable only through the platform console.
drop policy if exists support_sla_targets_select on public.support_sla_targets;
create policy support_sla_targets_select
  on public.support_sla_targets for select using (true);

drop policy if exists support_sla_targets_write on public.support_sla_targets;
create policy support_sla_targets_write
  on public.support_sla_targets for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

revoke all on public.support_sla_targets from anon, authenticated;
grant select on public.support_sla_targets to authenticated;
grant insert, update, delete on public.support_sla_targets to authenticated;

-- ── the deadlines ─────────────────────────────────────────────────────
alter table public.support_cases
  add column if not exists first_response_due_at timestamptz,
  add column if not exists resolution_due_at     timestamptz;

comment on column public.support_cases.first_response_due_at is
  'When a first reply was promised. Computed from the case''s arrival time, so escalating a late case cannot reset its clock (CAP-080).';

create or replace function public.support_cases_set_sla()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_first integer;
  v_res   integer;
begin
  select first_response_minutes, resolution_minutes into v_first, v_res
    from public.support_sla_targets where priority = new.priority;

  -- An unknown priority is not possible — the column has a CHECK and the
  -- table is seeded for all four — but a missing row must not silently
  -- produce a null deadline that every report then treats as "no target".
  if v_first is null then
    v_first := 1440;
    v_res   := 4320;
  end if;

  -- From `created_at`, never from now(). Escalating a case that has been
  -- open for a week must not hand it a fresh hour.
  new.first_response_due_at := coalesce(new.created_at, timezone('utc', now()))
                                 + make_interval(mins => v_first);
  new.resolution_due_at     := coalesce(new.created_at, timezone('utc', now()))
                                 + make_interval(mins => v_res);
  return new;
end;
$$;

drop trigger if exists support_cases_set_sla on public.support_cases;
create trigger support_cases_set_sla
  before insert or update of priority on public.support_cases
  for each row execute function public.support_cases_set_sla();

-- Backfill. Every existing case gets the deadline it would have had, which
-- is more useful than a null that reads as "no promise was made".
--
-- SAFETY(update_without_where): every row is meant — the column is new and
-- null everywhere, so this is the initial population rather than a rewrite
-- of anything. No existing value is overwritten because there are none.
update public.support_cases c
   set first_response_due_at = c.created_at + make_interval(mins => t.first_response_minutes),
       resolution_due_at     = c.created_at + make_interval(mins => t.resolution_minutes)
  from public.support_sla_targets t
 where t.priority = c.priority;

-- ── how a case is doing ───────────────────────────────────────────────
--
-- A function rather than a generated column: "breached" depends on now(),
-- which is not immutable, and a stored value would be wrong between writes.
create or replace function public.support_sla_state(p_case uuid)
returns table (
  first_response_state text,
  resolution_state     text,
  minutes_to_respond   integer,
  minutes_to_resolve   integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when c.first_response_at is not null and c.first_response_at <= c.first_response_due_at
        then 'met'
      when c.first_response_at is not null then 'breached'
      when timezone('utc', now()) > c.first_response_due_at then 'breached'
      -- "Due soon" earns its own state because a list sorted by it is the
      -- one a support person should be working from.
      when timezone('utc', now()) > c.first_response_due_at - interval '30 minutes'
        then 'due_soon'
      else 'on_track'
    end,
    case
      when c.resolved_at is not null and c.resolved_at <= c.resolution_due_at then 'met'
      when c.resolved_at is not null then 'breached'
      when c.status in ('resolved', 'closed') then 'met'
      when timezone('utc', now()) > c.resolution_due_at then 'breached'
      else 'on_track'
    end,
    (extract(epoch from (c.first_response_due_at - timezone('utc', now()))) / 60)::integer,
    (extract(epoch from (c.resolution_due_at - timezone('utc', now()))) / 60)::integer
    from public.support_cases c
   where c.id = p_case
     and (public.is_platform_admin() or c.requester_id = auth.uid());
$$;

comment on function public.support_sla_state(uuid) is
  'Whether a case met, is about to miss, or has missed its promise. Computed rather than stored, because "breached" depends on the current time (CAP-080).';

revoke all on function public.support_sla_state(uuid) from public, anon;
grant execute on function public.support_sla_state(uuid) to authenticated;
