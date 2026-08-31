-- =====================================================================
-- 0097_overtime_evidence.sql — an overtime claim can be checked against
-- what the clock actually recorded (docs/SAAS.md CAP-087)
--
-- `overtime_requests.hours` is a number somebody types. Nothing has ever
-- compared it to anything, so a manager approving one is approving an
-- assertion — and the row goes to payroll. That is the gap.
--
-- ## Evidence, not derivation
--
-- The obvious fix is to compute overtime from clock events and stop
-- asking. That would be wrong here, and the reason matters: clock data
-- is routinely incomplete in exactly the situations overtime arises
-- from. A carer who stays late to cover an incident is the person most
-- likely to forget to clock out. `0037` exists because event times get
-- reported hours after the fact. Deriving a number from that and paying
-- it would be worse than a typed one, because it would look
-- authoritative.
--
-- So this returns what the clock recorded and what was scheduled, and
-- leaves the judgement where it already is. The approver sees "declared
-- 2.5h; the clock shows 9h20 worked against 8h scheduled" and can act
-- on the difference — including approving a claim the clock does not
-- support, which is a real and legitimate case.
--
-- ## Pairing
--
-- `in` to the next `out`, per person per day, in the organisation's
-- timezone. Breaks are NOT deducted: `break_start`/`break_end` are
-- optional in this product and mostly unused, so subtracting them would
-- silently under-report for everyone who does not use them. The
-- function returns paired clock time and says what it is.
--
-- An unpaired `in` — the forgotten clock-out — contributes nothing
-- rather than running to midnight. A number that quietly assumed a
-- 15-hour shift would be the authoritative-looking wrong answer this
-- whole design is avoiding.
-- =====================================================================

create or replace function public.overtime_evidence(
  p_org   uuid,
  p_staff uuid,
  p_date  date
)
returns table (
  scheduled_minutes integer,
  worked_minutes    integer,
  unpaired_events   integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
begin
  -- Membership is the whole guard: this reads one person's attendance, which
  -- is exactly the kind of row cross-tenant isolation exists to protect.
  if not public.is_org_member(p_org) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  -- The organisation's timezone if it has one, else the fleet default. A day
  -- boundary in the wrong zone moves a night shift into the wrong date, which
  -- is the bug class 0036 and 0080 both had to be careful about.
  select coalesce(
           (select l.timezone from public.locations l
             where l.org_id = p_org and l.timezone is not null
             order by l.created_at limit 1),
           'Europe/London')
    into v_tz;

  return query
  with day_events as (
    select c.event_at,
           c.type,
           lead(c.event_at) over (order by c.event_at) as next_at,
           lead(c.type)     over (order by c.event_at) as next_type
      from public.clock_events c
     where c.org_id = p_org
       and c.staff_profile_id = p_staff
       and (c.event_at at time zone v_tz)::date = p_date
       and c.type in ('in', 'out')
  ),
  paired as (
    select extract(epoch from (next_at - event_at)) / 60 as minutes
      from day_events
     where type = 'in' and next_type = 'out'
  ),
  scheduled as (
    select coalesce(sum(
             extract(epoch from (s.ends_at - s.starts_at)) / 60
             - coalesce(s.break_minutes, 0)
           ), 0) as minutes
      from public.shifts s
     where s.org_id = p_org
       and s.staff_profile_id = p_staff
       and (s.starts_at at time zone v_tz)::date = p_date
       and s.status <> 'cancelled'
  )
  select
    (select minutes from scheduled)::integer,
    coalesce((select sum(minutes) from paired), 0)::integer,
    -- An `in` with no `out` after it. Surfaced rather than absorbed: it is
    -- the difference between "they worked nothing" and "we do not know", and
    -- an approver needs to be able to tell those apart.
    (select count(*) from day_events where type = 'in' and next_type is distinct from 'out')::integer;
end;
$$;

comment on function public.overtime_evidence(uuid, uuid, date) is
  'What the clock recorded and what was scheduled for one person on one day, so an overtime claim can be judged against something. Deliberately not a derivation: clock data is least complete exactly when overtime happens (CAP-087).';

revoke all on function public.overtime_evidence(uuid, uuid, date) from public, anon;
grant execute on function public.overtime_evidence(uuid, uuid, date) to authenticated;
