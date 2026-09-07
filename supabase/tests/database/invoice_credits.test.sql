-- =====================================================================
-- invoice_credits.test.sql — GAP-080, credit_invoice (0149)
--
-- The billing console's "Credit" button was disabled since it shipped and was
-- removed in 0138's pass rather than left as a promise. GAP-080 recorded why
-- finishing it was not a UI task: no table, no RPC, no rules.
--
-- Each assertion pins a rule that is derived from the schema rather than
-- invented, which is the whole point of the design:
--
--   role      the PLATFORM_BILLING_ROLES list, the same one invoices_select uses
--   status    open / past_due / paid, from the status CHECK on invoices
--   ceiling   the invoice gross, less what is already credited
--   currency  inherited from the invoice, never a parameter
--   reason    required, so a credit is never indistinguishable from a mistake
--   idempotent on (invoice, key), like claim_billing_event (0125)
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, crypt('x', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb
from (values
  ('ea000000-0000-0000-0000-000000000001'::uuid, 'credit-finance@example.test'),
  ('ea000000-0000-0000-0000-000000000002'::uuid, 'credit-support@example.test')
) as v(id, email);

insert into public.platform_admins (user_id, role) values
  ('ea000000-0000-0000-0000-000000000001', 'platform_finance'),
  ('ea000000-0000-0000-0000-000000000002', 'platform_support');

insert into public.organisations (id, name, slug)
values ('eb000000-0000-0000-0000-000000000001', 'Credit Care Ltd', 'credit-care');

-- Gross 12000: 10000 + 2000 tax. The ceiling is the gross, not the net.
insert into public.invoices
  (id, org_id, number, period_start, period_end, amount_pence, tax_pence,
   currency, status, issued_on, due_on, paid_at)
values
  ('ec000000-0000-0000-0000-000000000001', 'eb000000-0000-0000-0000-000000000001',
   'INV-CREDIT-1', current_date - 30, current_date, 10000, 2000,
   'GBP', 'paid', current_date - 30, current_date - 16, now()),
  ('ec000000-0000-0000-0000-000000000002', 'eb000000-0000-0000-0000-000000000001',
   'INV-CREDIT-2', current_date - 30, current_date, 5000, 0,
   'GBP', 'void', current_date - 30, current_date - 16, null),
  -- Untouched, so the idempotency assertion has headroom: the FIRST keyed call
  -- still has to pass every rule, and only the retry short-circuits.
  ('ec000000-0000-0000-0000-000000000003', 'eb000000-0000-0000-0000-000000000001',
   'INV-CREDIT-3', current_date - 30, current_date, 3000, 0,
   'GBP', 'open', current_date - 30, current_date - 16, null);

create or replace function pg_temp.become(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text,
    true);
$$;

set local role authenticated;

-- ---------- who may ----------------------------------------------------
select pg_temp.become('ea000000-0000-0000-0000-000000000002');

select throws_ok(
  $$ select public.credit_invoice('ec000000-0000-0000-0000-000000000001',
       1000, 'Goodwill after the outage') $$,
  '42501',
  'Only platform billing staff can credit an invoice',
  'platform_support cannot credit: it cannot even read the billing console');

select pg_temp.become('ea000000-0000-0000-0000-000000000001');

-- ---------- the rules ---------------------------------------------------
select throws_ok(
  $$ select public.credit_invoice('ec000000-0000-0000-0000-000000000002',
       100, 'Crediting a withdrawn claim') $$,
  '22023', null,
  'a void invoice cannot be credited: the claim was already withdrawn');

select throws_ok(
  $$ select public.credit_invoice('ec000000-0000-0000-0000-000000000001',
       0, 'A credit of nothing at all') $$,
  '22023', null,
  'a credit must be a positive amount');

select throws_ok(
  $$ select public.credit_invoice('ec000000-0000-0000-0000-000000000001',
       100, 'oops') $$,
  '22023', null,
  'and needs a reason, so it is never indistinguishable from a mistake');

-- The ceiling is the GROSS, 12000, not the 10000 net.
select throws_ok(
  $$ select public.credit_invoice('ec000000-0000-0000-0000-000000000001',
       12001, 'More than the invoice was ever worth') $$,
  '22023', null,
  'and cannot exceed the invoice gross, tax included');

select lives_ok(
  $$ select public.credit_invoice('ec000000-0000-0000-0000-000000000001',
       12000, 'Full credit for the January outage') $$,
  'crediting exactly the gross is allowed');

select is(
  (select currency from public.invoice_credits
    where invoice_id = 'ec000000-0000-0000-0000-000000000001' limit 1),
  'GBP',
  'and the currency comes from the invoice, never from the caller');

-- ---------- the ceiling counts what is already there --------------------
select throws_ok(
  $$ select public.credit_invoice('ec000000-0000-0000-0000-000000000001',
       1, 'One more penny on a fully credited invoice') $$,
  '22023', null,
  'a second credit is measured against what is already credited, not zero');

-- ---------- idempotency -------------------------------------------------
--
-- Same key twice returns the SAME credit rather than adding a second. On a
-- fresh invoice, because the first keyed call is an ordinary credit and must
-- pass every rule — only the RETRY short-circuits. Asserting it against a
-- fully-credited invoice would have tested the ceiling, not idempotency, and
-- the first draft of this file did exactly that.
select is(
  (
    select public.credit_invoice('ec000000-0000-0000-0000-000000000003',
             500, 'Retried request, same key', 'idem-key-1')
      = public.credit_invoice('ec000000-0000-0000-0000-000000000003',
             500, 'Retried request, same key', 'idem-key-1')
  ),
  true,
  'a retry with the same key returns the credit already recorded');

select is(
  (select count(*)::int from public.invoice_credits
    where invoice_id = 'ec000000-0000-0000-0000-000000000003'),
  1,
  'and leaves exactly one credit, not two');

select * from finish();
rollback;
