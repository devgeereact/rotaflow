-- =====================================================================
-- invoice_documents.test.sql: an invoice has its documents (0156, F3)
--
-- What has to hold:
--
--   1. the organisation's owner reads its own invoices, links included;
--   2. a manager and a member of staff of the same organisation read none;
--   3. another organisation's owner reads none of them;
--   4. the link columns accept only https on Stripe's invoice hosts, so a
--      stored link cannot become an open redirect;
--   5. nobody signed in can write a link (writes are service_role's).
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(14);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('f3000000-0000-0000-0000-000000000001'::uuid, 'docs-owner@example.test'),
  ('f3000000-0000-0000-0000-000000000002'::uuid, 'docs-manager@example.test'),
  ('f3000000-0000-0000-0000-000000000003'::uuid, 'docs-staff@example.test'),
  ('f3000000-0000-0000-0000-000000000004'::uuid, 'docs-other-owner@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug) values
  ('f3001000-0000-0000-0000-000000000001', 'Documents Care Ltd', 'documents-care'),
  ('f3001000-0000-0000-0000-000000000002', 'Elsewhere Care Ltd', 'elsewhere-care');

insert into public.memberships (org_id, user_id, role, status) values
  ('f3001000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('f3001000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000002', 'manager', 'active'),
  ('f3001000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000003', 'staff', 'active'),
  ('f3001000-0000-0000-0000-000000000002', 'f3000000-0000-0000-0000-000000000004', 'owner', 'active');

-- Written as the database owner, standing in for the webhook's service_role.
insert into public.invoices
  (id, org_id, number, period_start, period_end, amount_pence, currency,
   status, issued_on, due_on, paid_at, provider, provider_ref,
   hosted_invoice_url, invoice_pdf)
values
  ('f3002000-0000-0000-0000-000000000001', 'f3001000-0000-0000-0000-000000000001',
   'DOCS-0001', current_date - 30, current_date, 4900, 'GBP',
   'paid', current_date - 30, current_date - 30, now(), 'stripe', 'in_docs_1',
   'https://invoice.stripe.com/i/acct_TEST/test_abc?s=ap',
   'https://pay.stripe.com/invoice/acct_TEST/test_abc/pdf?s=ap'),
  ('f3002000-0000-0000-0000-000000000002', 'f3001000-0000-0000-0000-000000000002',
   'DOCS-0002', current_date - 30, current_date, 9900, 'GBP',
   'open', current_date - 30, current_date, null, 'stripe', 'in_docs_2',
   'https://invoice.stripe.com/i/acct_TEST/test_def?s=ap', null);

create or replace function pg_temp.become(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true);
$$;

-- ---------- 4. Only Stripe's hosts, checked before anyone signs in ------
select throws_ok(
  $$ update public.invoices set hosted_invoice_url = 'https://evil.example/i/x'
      where id = 'f3002000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a hosted link on another host is refused');

select throws_ok(
  $$ update public.invoices set invoice_pdf = 'http://pay.stripe.com/invoice/x/pdf'
      where id = 'f3002000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a PDF link over plain http is refused');

select throws_ok(
  $$ update public.invoices set hosted_invoice_url = 'https://invoice.stripe.com@evil.example/x'
      where id = 'f3002000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a Stripe-looking host with userinfo pointing elsewhere is refused');

select throws_ok(
  $$ update public.invoices set invoice_pdf = 'https://pay.stripe.com.evil.example/x'
      where id = 'f3002000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a host that only begins with a Stripe host is refused');

select throws_ok(
  $$ update public.invoices set hosted_invoice_url = 'javascript:alert(1)'
      where id = 'f3002000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a script URL is refused');

select lives_ok(
  $$ update public.invoices set invoice_pdf = null
      where id = 'f3002000-0000-0000-0000-000000000002' $$,
  'no link at all is allowed (a draft, or a manually issued invoice)');

set local role authenticated;

-- ---------- 1. The owner reads its own, links included ------------------
select pg_temp.become('f3000000-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.invoices),
  1,
  'the owner sees exactly their own organisation''s invoice');

select is(
  (select hosted_invoice_url || ' ' || invoice_pdf from public.invoices
    where id = 'f3002000-0000-0000-0000-000000000001'),
  'https://invoice.stripe.com/i/acct_TEST/test_abc?s=ap https://pay.stripe.com/invoice/acct_TEST/test_abc/pdf?s=ap',
  'and reads both of its links');

-- ---------- 5. Nobody signed in writes a link ---------------------------
select throws_ok(
  $$ update public.invoices set hosted_invoice_url = 'https://invoice.stripe.com/i/other'
      where id = 'f3002000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'the owner cannot rewrite a link: writes belong to the webhook');

-- ---------- 2. Manager and staff of the same organisation ---------------
select pg_temp.become('f3000000-0000-0000-0000-000000000002');

select is(
  (select count(*)::int from public.invoices),
  0,
  'a manager reads no invoice: billing is the owner''s');

select is(
  (select hosted_invoice_url from public.invoices
    where id = 'f3002000-0000-0000-0000-000000000001'),
  null,
  'so a manager reads no link either');

select pg_temp.become('f3000000-0000-0000-0000-000000000003');

select is(
  (select count(*)::int from public.invoices),
  0,
  'a member of staff reads no invoice');

-- ---------- 3. Another organisation's owner ------------------------------
select pg_temp.become('f3000000-0000-0000-0000-000000000004');

select is(
  (select count(*)::int from public.invoices
    where org_id = 'f3001000-0000-0000-0000-000000000001'),
  0,
  'another organisation''s owner reads none of this organisation''s invoices');

select is(
  (select count(*)::int from public.invoices),
  1,
  'and sees only their own');

select * from finish();
rollback;
