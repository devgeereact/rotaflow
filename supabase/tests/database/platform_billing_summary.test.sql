-- =====================================================================
-- platform_billing_summary.test.sql — billing totals are summed over
-- every row and never across two currencies (0134)
--
-- ## The defects
--
-- Collected, Outstanding, Past due and Refunds were sums over
-- `listInvoices(300)` — a bounded list, printed as platform totals. On a
-- table that grows once per customer per month, "outstanding" quietly
-- became "outstanding among the most recent three hundred invoices",
-- which is not a debt figure.
--
-- And every one of them added `amount_pence` to `amount_pence` across
-- currencies, then printed the result with a pound sign, because
-- `formatMoney` defaults to GBP.
--
-- ## Shown to fail on the real defect
--
-- Assertion 4 fails against any implementation that ignores currency: it
-- returns one row of 30000 rather than two rows of 20000 GBP and 10000
-- EUR.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(11);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-0000000000f1',
   'authenticated', 'authenticated', 'bill-finance@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-0000000000f2',
   'authenticated', 'authenticated', 'bill-support@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}');

insert into public.platform_admins (user_id, role) values
  ('b0000000-0000-0000-0000-0000000000f1', 'platform_finance'),
  ('b0000000-0000-0000-0000-0000000000f2', 'platform_support');

insert into public.organisations (id, name, slug, created_by) values
  ('b1000000-0000-0000-0000-000000000001', 'Sterling Ltd', 'sterling', null),
  ('b1000000-0000-0000-0000-000000000002', 'Euro GmbH',    'euro-gmbh', null);

-- One subscription per currency. £200 and €100 a month.
insert into public.subscriptions (org_id, plan, status, price_pence, currency) values
  ('b1000000-0000-0000-0000-000000000001', 'business', 'active',   20000, 'GBP'),
  ('b1000000-0000-0000-0000-000000000002', 'business', 'past_due', 10000, 'EUR');

-- Paid this month, one per currency; one still open in sterling.
insert into public.invoices
  (org_id, number, period_start, period_end, amount_pence, currency, status, issued_on, due_on, paid_at)
values
  ('b1000000-0000-0000-0000-000000000001', 'INV-T1',
   date_trunc('month', timezone('utc', now()))::date,
   (date_trunc('month', timezone('utc', now())) + interval '1 month')::date,
   20000, 'GBP', 'paid',
   date_trunc('month', timezone('utc', now()))::date,
   (date_trunc('month', timezone('utc', now())) + interval '14 days')::date,
   date_trunc('month', timezone('utc', now())) + interval '1 day'),
  ('b1000000-0000-0000-0000-000000000002', 'INV-T2',
   date_trunc('month', timezone('utc', now()))::date,
   (date_trunc('month', timezone('utc', now())) + interval '1 month')::date,
   10000, 'EUR', 'paid',
   date_trunc('month', timezone('utc', now()))::date,
   (date_trunc('month', timezone('utc', now())) + interval '14 days')::date,
   date_trunc('month', timezone('utc', now())) + interval '2 days'),
  ('b1000000-0000-0000-0000-000000000001', 'INV-T3',
   (date_trunc('month', timezone('utc', now())) - interval '3 months')::date,
   (date_trunc('month', timezone('utc', now())) - interval '2 months')::date,
   5000, 'GBP', 'past_due',
   (date_trunc('month', timezone('utc', now())) - interval '3 months')::date,
   (date_trunc('month', timezone('utc', now())) - interval '2 months')::date,
   null);

create or replace function pg_temp.become(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true);
$$;

set local role authenticated;

-- ---------- 1-2. the role boundary ------------------------------------
select pg_temp.become('b0000000-0000-0000-0000-0000000000f2');

select throws_ok(
  $$ select * from public.platform_billing_summary() $$,
  '42501',
  'Only a billing platform role can read the billing summary',
  'support is refused: billing is not its documented scope');

select throws_ok(
  $$ select * from public.platform_invoice_directory() $$,
  '42501',
  'Only a billing platform role can read the invoice directory',
  'and so is the invoice list');

-- ---------- 3-6. one row per currency, never a conversion -------------
select pg_temp.become('b0000000-0000-0000-0000-0000000000f1');

select is(
  (select count(*)::int from public.platform_billing_summary()),
  2,
  'two currencies produce two rows');

select is(
  (select mrr_pence::int from public.platform_billing_summary() where currency = 'GBP'),
  20000,
  'sterling MRR is sterling MRR');

select is(
  (select mrr_pence::int from public.platform_billing_summary() where currency = 'EUR'),
  10000,
  'and the euro one is not added to it — 200 GBP plus 100 EUR is not 300 of anything');

-- Past due is in MRR: a past-due subscription is still a customer with a
-- contract, and writing it out the day a card fails makes the headline
-- swing on payment retries rather than on customers.
select is(
  (select paying_orgs::int from public.platform_billing_summary() where currency = 'EUR'),
  1,
  'a past-due subscription still counts as paying');

-- ---------- 7-8. debt is not scoped to a month ------------------------
select is(
  (select outstanding_pence::int from public.platform_billing_summary()
    where currency = 'GBP'),
  5000,
  'an invoice from three months ago that is still open is money owed today');

select is(
  (select collected_month_pence::int from public.platform_billing_summary()
    where currency = 'GBP'),
  20000,
  'collections are counted by payment date');

-- ---------- 9-11. the invoice directory -------------------------------
select is(
  (select distinct total_count::int from public.platform_invoice_directory()),
  3,
  'the directory counts every matching invoice');

select is(
  (select count(*)::int from public.platform_invoice_directory(
     p_currency => array['EUR'])),
  1,
  'and can be filtered to one currency, which is how a total becomes printable');

select is(
  (select org_name from public.platform_invoice_directory(p_search => 'INV-T2')),
  'Euro GmbH',
  'search covers the invoice number and resolves the organisation name');

select * from finish();
rollback;
