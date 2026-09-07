-- =====================================================================
-- 0133_the_overview_counts_the_estate.sql — the platform overview's
-- growth and churn series are aggregated in the database
--
-- ## The gap
--
-- `/admin` built its headline chart by loading every organisation and
-- every subscription into the browser and bucketing the arrays by month.
-- PostgREST truncates a response at `db.max_rows` without saying so, so
-- past the cap the growth chart is a chart of the most recent thousand
-- tenants — which is not a growth chart, it is a chart of the cap, and
-- it slopes the wrong way as the estate grows.
--
-- The same read fed the tenant and account totals on the same screen.
-- `platform_totals()` (0028) already returns those as real counts and
-- was sitting unused beside them.
--
-- ## The buckets match the TypeScript, deliberately and by test
--
-- `monthlyGrowth` and `monthlyChurnCounts` in
-- `src/lib/platformOverview.ts` define the boundaries: a month runs from
-- the first of the month inclusive to the first of the next exclusive,
-- because an inclusive end double-counts anything created at midnight on
-- the 1st. Churn is gated on the CURRENT status being 'canceled', not on
-- `canceled_at` alone — Stripe's portal sets that when a cancellation is
-- *requested*, weeks before it takes effect, and counting it early would
-- contradict every MRR figure on the same page.
--
-- Both rules are reproduced here and asserted against the same cases in
-- `supabase/tests/database/platform_overview.test.sql`, for the same
-- reason `0130` gives about the health band: a rule written twice needs
-- to be tested twice or it drifts.
--
-- ## Timezone
--
-- Buckets are UTC months. The TypeScript buckets in the browser's zone,
-- which for a UK operator is the same month boundary except for one hour
-- twice a year. That difference is real and it is stated on the screen
-- rather than papered over: a tenant created at 00:30 on 1 April BST
-- lands in March by this function and April by the old one. Choosing UTC
-- makes the chart identical for every reader, which is the more useful
-- property for a shared operations screen.
--
-- SAFETY(none): additive. Two new functions, no table altered, no policy
-- changed, no grant widened beyond EXECUTE to `authenticated` on
-- functions that refuse a non-administrator before reading anything.
-- =====================================================================

create or replace function public.platform_growth(p_months integer default 12)
returns table (
  month_start     date,
  created         bigint,
  total           bigint,
  churned         bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_months integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform staff can read platform growth'
      using errcode = '42501';
  end if;

  -- Bounded. A caller asking for 600 months would scan the whole table
  -- once per bucket for a chart nobody can read.
  v_months := least(greatest(coalesce(p_months, 12), 1), 36);

  return query
  with months as (
    select generate_series(
             date_trunc('month', timezone('utc', now())) - ((v_months - 1) || ' months')::interval,
             date_trunc('month', timezone('utc', now())),
             interval '1 month'
           )::date as month_start
  )
  select
    m.month_start,
    (select count(*) from public.organisations o
      where o.created_at >= m.month_start
        and o.created_at <  (m.month_start + interval '1 month')),
    -- Cumulative: every organisation that existed by the end of the
    -- bucket. `< next month start` rather than `<= end of month`, because
    -- an inclusive end double-counts midnight on the 1st.
    (select count(*) from public.organisations o
      where o.created_at < (m.month_start + interval '1 month')),
    -- Churn is gated on the current status, not on canceled_at alone.
    (select count(*) from public.subscriptions s
      where s.status = 'canceled'
        and s.canceled_at is not null
        and s.canceled_at >= m.month_start
        and s.canceled_at <  (m.month_start + interval '1 month'))
    from months m
   order by m.month_start;
end;
$$;

comment on function public.platform_growth(integer) is
  'Organisations created, cumulative total and subscriptions churned, per UTC '
  'month. The database half of monthlyGrowth/monthlyChurnCounts in '
  'src/lib/platformOverview.ts; the two are asserted against the same '
  'boundaries by platform_overview.test.sql. See 0133.';

revoke execute on function public.platform_growth(integer) from public, anon;
grant execute on function public.platform_growth(integer) to authenticated;

-- ---------------------------------------------------------------------
-- The support and access numbers the overview shows, as counts.
--
-- `listSupportCases()` returns up to two hundred rows so the screen can
-- count the open ones. The count is the whole question, and two hundred
-- rows is the wrong way to ask it — it is also a cap, so a deployment
-- with three hundred open cases reports two hundred.
-- ---------------------------------------------------------------------
create or replace function public.platform_operations_summary()
returns table (
  open_cases            bigint,
  urgent_open_cases     bigint,
  unassigned_open_cases bigint,
  open_incidents        bigint,
  active_support_sessions bigint,
  failed_notifications  bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Operational, not merely administrative: this counts support cases and
  -- incidents, which 0122 keeps away from platform_finance.
  if not public.is_platform_operational() then
    raise exception 'Only an operational platform role can read the operations summary'
      using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from public.support_cases c
      where c.status in ('open', 'pending', 'on_hold')),
    (select count(*) from public.support_cases c
      where c.status in ('open', 'pending', 'on_hold') and c.priority = 'urgent'),
    (select count(*) from public.support_cases c
      where c.status in ('open', 'pending', 'on_hold') and c.assigned_to is null),
    (select count(*) from public.incidents i
      where i.resolved_at is null),
    (select count(*) from public.support_access_sessions s
      where s.revoked_at is null and s.expires_at > timezone('utc', now())),
    -- A dispatch that will not be retried again. `pending` is in flight and
    -- `sent` may still be reconciled into a retry, so neither is a failure
    -- yet; only `abandoned` is one somebody has to look at.
    (select count(*) from public.notification_outbox o
      where o.status = 'abandoned');
end;
$$;

comment on function public.platform_operations_summary() is
  'The support, incident, access and delivery counts on /admin, as counts '
  'rather than as the length of a capped list. Operational platform roles '
  'only, mirroring 0122. See 0133.';

revoke execute on function public.platform_operations_summary() from public, anon;
grant execute on function public.platform_operations_summary() to authenticated;
