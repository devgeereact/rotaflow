-- =====================================================================
-- platform_finance_boundary.test.sql — the part of GAP-053 that 0122 left
-- (closed by 0138)
--
-- `platform_reads.test.sql` beside this file covers the eight TABLES `0122`
-- fixed. It passes, and it passed while every assertion below would have
-- failed, because `0122` enumerated tables by hand and never looked at
-- functions. This file covers the rest of the surface that `is_platform_admin()`
-- guarded on its own:
--
--   * `gdpr_requests` — the one POLICY it missed, and the worst of them: a
--     data subject's name, email, extension reason and outcome note.
--   * `platform_user_auth_facts` / `platform_auth_facts_summary` — read
--     `auth.users`. `0122`'s own header claims the first "does not exist in
--     this schema". It has existed since `0027`.
--   * `platform_tenant_counts` — staff, locations, departments, rotas, shifts.
--   * `support_sla_state` — the promise on a case finance cannot read.
--   * `reply_to_support_case` — a WRITE. Finance could post into a case it
--     cannot open, rendering to the customer as "Platform", and could write a
--     message flagged `is_internal`.
--   * `organisation_deletion_preview` — admitted any platform role while
--     `delete_organisation` admits two.
--
-- ## Shown to fail on the real defect
--
-- With `0138` reverted and the database rebuilt, assertions 1 to 8 fail:
-- finance reads the DSAR row, both auth-fact functions return, the tenant
-- counts return, the SLA row returns, the reply is accepted and the deletion
-- preview returns.
--
-- ## The other half of the assertion
--
-- A boundary that refuses everyone is not a boundary. 9 to 14 prove support
-- still does its job through every one of these paths, and 15 to 16 prove
-- finance keeps what it is entitled to — seat counts and the organisations
-- list, which are the billing console this role exists to use.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(16);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '81818181-8181-8181-8181-818181818181',
   'authenticated', 'authenticated', 'boundary-finance@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '82828282-8282-8282-8282-828282828282',
   'authenticated', 'authenticated', 'boundary-support@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '83838383-8383-8383-8383-838383838383',
   'authenticated', 'authenticated', 'boundary-owner@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}');

insert into public.platform_admins (user_id, role) values
  ('81818181-8181-8181-8181-818181818181', 'platform_finance'),
  ('82828282-8282-8282-8282-828282828282', 'platform_support');

insert into public.organisations (id, name, slug, created_by) values
  ('88888888-0000-0000-0000-000000000001', 'Boundary Care Ltd', 'boundary-care',
   '83838383-8383-8383-8383-838383838383');

-- A staff row and a location, so the tenant counts have something to return
-- and "finance reads zero" cannot pass by accident on an empty tenant.
insert into public.locations (org_id, name)
values ('88888888-0000-0000-0000-000000000001', 'Boundary House');

-- The DSAR register row. `received_on` and `due_on` are what the board reads;
-- the subject's name and email are what makes this the worst of the set.
insert into public.gdpr_requests
  (org_id, kind, subject_name, subject_email, received_on, due_on, status)
values
  ('88888888-0000-0000-0000-000000000001', 'access', 'A Data Subject',
   'subject@example.test', current_date, current_date + 30, 'received');

insert into public.support_cases
  (id, reference, org_id, requester_id, requester_email, subject, priority)
values
  ('88888888-1000-0000-0000-000000000001', 'BOUND-1',
   '88888888-0000-0000-0000-000000000001', '83838383-8383-8383-8383-838383838383',
   'boundary-owner@example.test', 'A case finance must not touch', 'normal');

create or replace function pg_temp.become(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true);
$$;

set local role authenticated;

-- ---------- finance is outside all of it ------------------------------
select pg_temp.become('81818181-8181-8181-8181-818181818181');

select is((select count(*)::int from public.gdpr_requests), 0,
  'platform_finance reads no GDPR requests: a DSAR register is not billing state');

select throws_ok(
  $$ select * from public.platform_user_auth_facts('83838383-8383-8383-8383-838383838383') $$,
  '42501',
  'Only operational platform staff can read account security facts',
  'platform_finance cannot read one account''s security facts');

select throws_ok(
  $$ select * from public.platform_auth_facts_summary() $$,
  '42501',
  'Only operational platform staff can read account security facts',
  'platform_finance cannot read the estate''s account security summary');

select throws_ok(
  $$ select * from public.platform_tenant_counts('88888888-0000-0000-0000-000000000001') $$,
  '42501',
  'Only operational platform staff can read tenant counts',
  'platform_finance cannot count a tenant''s staff, rotas and shifts');

select is(
  (select count(*)::int from public.support_sla_state('88888888-1000-0000-0000-000000000001')),
  0,
  'platform_finance reads no SLA state for a case it cannot open');

-- The write. This is the assertion that matters most: a read it should not
-- have is a leak, a write it should not have is a message the customer sees.
select throws_ok(
  $$ select public.reply_to_support_case(
       '88888888-1000-0000-0000-000000000001', 'I should not be able to say this', false) $$,
  '42501',
  'You cannot reply to that case',
  'platform_finance cannot post a customer-visible reply into a case');

select throws_ok(
  $$ select public.reply_to_support_case(
       '88888888-1000-0000-0000-000000000001', 'Nor an internal note', true) $$,
  '42501',
  'You cannot reply to that case',
  'platform_finance cannot write an internal note either');

select is(
  (select count(*)::int
     from public.organisation_deletion_preview('88888888-0000-0000-0000-000000000001')),
  0,
  'platform_finance cannot preview what deleting a tenant would destroy');

-- ---------- support still does its job --------------------------------
select pg_temp.become('82828282-8282-8282-8282-828282828282');

select isnt((select count(*)::int from public.gdpr_requests), 0,
  'platform_support still reads the GDPR register');

select lives_ok(
  $$ select * from public.platform_user_auth_facts('83838383-8383-8383-8383-838383838383') $$,
  'platform_support still reads an account''s security facts');

select lives_ok(
  $$ select * from public.platform_auth_facts_summary() $$,
  'platform_support still reads the account security summary');

select is(
  (select locations::int
     from public.platform_tenant_counts('88888888-0000-0000-0000-000000000001')),
  1,
  'platform_support still counts a tenant''s locations, and gets the real number');

select isnt(
  (select count(*)::int from public.support_sla_state('88888888-1000-0000-0000-000000000001')),
  0,
  'platform_support still reads the SLA state on a case it works');

select lives_ok(
  $$ select public.reply_to_support_case(
       '88888888-1000-0000-0000-000000000001', 'Support can answer this', false) $$,
  'platform_support still replies to a case');

-- ---------- and finance keeps the console it exists for ----------------
select pg_temp.become('81818181-8181-8181-8181-818181818181');

select isnt((select count(*)::int from public.organisations), 0,
  'platform_finance still reads organisations');

select lives_ok(
  $$ select * from public.platform_staff_counts() $$,
  'platform_finance still reads seat counts: seats ARE billing state');

select * from finish();
rollback;
