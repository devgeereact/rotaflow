-- =====================================================================
-- platform_overview.test.sql — the overview's growth and churn series
-- are counted over the estate, with the same month boundaries the
-- TypeScript uses (0133)
--
-- ## The defect
--
-- `/admin` loaded every organisation and every subscription into the
-- browser and bucketed the arrays. PostgREST truncates at `db.max_rows`,
-- so past the cap the growth chart charts the cap rather than the
-- estate, and slopes the wrong way as the product succeeds.
--
-- ## The boundaries are the interesting part
--
-- `monthlyGrowth` uses `[first of month, first of next month)` because an
-- inclusive end double-counts anything created at midnight on the 1st,
-- and `monthlyChurnCounts` gates on the CURRENT status being 'canceled'
-- rather than on `canceled_at` alone — Stripe sets that when a
-- cancellation is requested, weeks before it takes effect. Assertions 3
-- to 6 are those two rules.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000e1',
   'authenticated', 'authenticated', 'ov-owner@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-0000000000e2',
   'authenticated', 'authenticated', 'ov-finance@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}');

insert into public.platform_admins (user_id, role) values
  ('a0000000-0000-0000-0000-0000000000e1', 'platform_owner'),
  ('a0000000-0000-0000-0000-0000000000e2', 'platform_finance');

-- One created at exactly midnight on the first of this UTC month. It
-- belongs to this month and to no other; an inclusive end boundary would
-- put it in both.
insert into public.organisations (id, name, slug, created_at, created_by) values
  ('a1000000-0000-0000-0000-000000000001', 'Boundary Ltd', 'boundary',
   date_trunc('month', timezone('utc', now())), null),
  ('a1000000-0000-0000-0000-000000000002', 'Last Month Ltd', 'last-month',
   date_trunc('month', timezone('utc', now())) - interval '10 days', null),
  ('a1000000-0000-0000-0000-000000000003', 'Ancient Ltd', 'ancient',
   date_trunc('month', timezone('utc', now())) - interval '11 months', null);

-- Cancelled and actually stopped: counts as churn this month.
insert into public.subscriptions (org_id, plan, status, canceled_at)
values ('a1000000-0000-0000-0000-000000000002', 'business', 'canceled',
        date_trunc('month', timezone('utc', now())) + interval '2 days');

-- Cancellation REQUESTED but still active — Stripe's cancel-at-period-end.
-- It must not count as churn while it is still paying.
insert into public.subscriptions (org_id, plan, status, canceled_at)
values ('a1000000-0000-0000-0000-000000000003', 'business', 'active',
        date_trunc('month', timezone('utc', now())) + interval '3 days');

create or replace function pg_temp.become(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true);
$$;

set local role authenticated;

-- ---------- 1-2. the role boundaries ----------------------------------
select pg_temp.become('a0000000-0000-0000-0000-0000000000e2');

select is(
  (select count(*)::int from public.platform_growth(3)),
  3,
  'finance may read growth — organisations and subscriptions are billing state');

select throws_ok(
  $$ select * from public.platform_operations_summary() $$,
  '42501',
  'Only an operational platform role can read the operations summary',
  'but not the operations summary, which counts support cases and incidents');

-- ---------- 3-6. the month boundaries ---------------------------------
select pg_temp.become('a0000000-0000-0000-0000-0000000000e1');

select is(
  (select created::int from public.platform_growth(12)
    where month_start = date_trunc('month', timezone('utc', now()))::date),
  1,
  'a tenant created at midnight on the 1st belongs to this month');

select is(
  (select created::int from public.platform_growth(12)
    where month_start = (date_trunc('month', timezone('utc', now())) - interval '1 month')::date),
  1,
  'and not also to the previous one');

select is(
  (select total::int from public.platform_growth(12)
    where month_start = date_trunc('month', timezone('utc', now()))::date),
  3,
  'the cumulative total counts every tenant that existed by the end of the bucket');

select is(
  (select churned::int from public.platform_growth(12)
    where month_start = date_trunc('month', timezone('utc', now()))::date),
  1,
  'a cancellation counts once its subscription has actually stopped');

-- The requested-but-still-active one is the second subscription. If churn
-- were gated on canceled_at alone this would be 2, and it would contradict
-- every MRR figure on the same screen.
select is(
  (select sum(churned)::int from public.platform_growth(12)),
  1,
  'and a cancellation merely REQUESTED does not, while it is still paying');

-- ---------- 8-9. bounds ------------------------------------------------
select is(
  (select count(*)::int from public.platform_growth(600)),
  36,
  'a nonsense number of months is clamped rather than scanned');

select is(
  (select count(*)::int from public.platform_growth(0)),
  1,
  'and zero months is one month, not an empty chart');

select * from finish();
rollback;
