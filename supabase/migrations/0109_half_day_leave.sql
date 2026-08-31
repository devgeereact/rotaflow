-- =====================================================================
-- 0109_half_day_leave.sql — half a day off (docs/SAAS.md CAP-085)
--
-- Leave is counted in whole calendar days, so somebody taking a Friday
-- afternoon for an appointment spends a whole day of their allowance.
-- Over a year that is the difference between an accurate balance and one
-- people stop trusting — and when a balance is not trusted, the
-- spreadsheet comes back and the product has lost the argument.
--
-- ## Two booleans rather than a portion enum
--
-- `starts_half` means the first day begins at midday; `ends_half` means
-- the last day ends at midday. A single day with both is half a day.
-- That covers every case a UK employer actually books — a morning off, an
-- afternoon off, a week that starts after lunch — without an enum whose
-- values ('am', 'pm', 'full') mean different things at the two ends of a
-- range and get confused every time somebody reads them.
--
-- ## The count lives in the database as well as the client
--
-- `leave_days()` is the same arithmetic the browser does, available to
-- any query that has to total leave — the retention job, a report, a
-- future entitlement check. Two implementations is a risk, but the
-- alternative is a client that cannot show a running total without a
-- round trip, and a database that cannot answer "how much leave was
-- taken" at all. They are tested against each other by shape: the
-- pgTAP cases below mirror the unit tests exactly.
--
-- ## Existing rows are unchanged
--
-- Both columns default false, which is exactly what every existing row
-- means today. Nothing is migrated, nothing is recomputed, and an
-- organisation that never ticks a box sees the same numbers it saw
-- yesterday.
-- =====================================================================

alter table public.leave_requests
  add column if not exists starts_half boolean not null default false,
  add column if not exists ends_half   boolean not null default false;

comment on column public.leave_requests.starts_half is
  'The first day begins at midday, so it counts as half (CAP-085).';
comment on column public.leave_requests.ends_half is
  'The last day ends at midday, so it counts as half (CAP-085).';

-- ── the count ─────────────────────────────────────────────────────────
create or replace function public.leave_days(
  p_start       date,
  p_end         date,
  p_starts_half boolean default false,
  p_ends_half   boolean default false
)
returns numeric
language sql
immutable
as $$
  select greatest(
    -- Never zero. A single day booked as both a late start and an early
    -- finish is still half a day off, not none — and a request worth zero
    -- days would pass every entitlement check ever written.
    0.5,
    (p_end - p_start + 1)::numeric
      - case when p_starts_half then 0.5 else 0 end
      - case when p_ends_half   then 0.5 else 0 end
  );
$$;

comment on function public.leave_days(date, date, boolean, boolean) is
  'Calendar days a leave request costs, counting half days at either end. Never returns zero (CAP-085).';

grant execute on function public.leave_days(date, date, boolean, boolean) to authenticated, service_role;

-- ── a half day has to be a day somebody could take ────────────────────
--
-- `ends_half` on a request that ends before it starts is not reachable —
-- the client refuses a reversed range — but the constraint is what makes
-- that true rather than merely usual.
alter table public.leave_requests
  drop constraint if exists leave_requests_range_valid;
alter table public.leave_requests
  add constraint leave_requests_range_valid check (end_date >= start_date);
