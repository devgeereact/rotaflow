-- =====================================================================
-- staff_profile_column_visibility.test.sql — a colleague is not a payroll
-- record (0150, docs/SAAS.md GAP-117)
--
-- ## The defect this covers
--
-- `staff_profiles_select` is `using (is_org_member(org_id))`, and until
-- `0150` `authenticated` held SELECT on all twenty columns. So any member of
-- an organisation — a cleaner, not a manager — could ask PostgREST for a
-- colleague's `payroll_id`, `email`, `phone`, `start_date` and
-- `holiday_allowance` and be handed them.
--
-- ## Why no existing test caught it, which is the reason this file exists
--
-- Every RLS assertion in this directory, and all seventeen IDOR probes from
-- the August audit, ask CROSS-TENANT questions: can org A read org B. They
-- passed, and would have passed with this hole wide open, because the hole is
-- inside a single tenant. RLS is row-level — it decides whether you may see a
-- row, never which columns of it — so no policy test could have found this.
-- "Is RLS on" and "is this person allowed these fields" are different
-- questions and only the first was being asked anywhere.
--
-- ## Shown to fail on the real defect
--
-- With `0150` reverted and the database rebuilt, assertions 1 to 5 fail: the
-- staff account reads the manager's payroll id, email, phone, start date and
-- holiday allowance as real values rather than nulls.
--
-- ## The other half of the assertion
--
-- A mask that hides everything from everyone breaks payroll. So the rest
-- assert what must still work: the colleague's NAME still reads (a rota needs
-- it, and removing the row would break the product to fix a leak); a person
-- reads their own record in full, including `holiday_allowance`, which the
-- leave tiles compute from and would otherwise silently show as nothing; and a
-- manager reads all five for their team.
--
-- One assertion proves the direct path is closed rather than merely unused —
-- the revoke is what makes this a control, since without it the view is only a
-- politer way to ask the same question. The last keeps the tenancy guard
-- honest: the view is definer-rights, so `staff_profiles_select` is not
-- consulted, and if its own WHERE clause were ever dropped this is what would
-- notice.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(17);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', 'd1111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'visibility-manager@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'd2222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'visibility-staff@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'd3333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'visibility-outsider@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}');

insert into public.organisations (id, name, slug) values
  ('d0000000-0000-0000-0000-000000000001', 'Visibility Care Ltd', 'visibility-care'),
  ('d0000000-0000-0000-0000-000000000002', 'Other Tenant Ltd', 'other-tenant');

insert into public.memberships (org_id, user_id, role) values
  ('d0000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'manager'),
  ('d0000000-0000-0000-0000-000000000001', 'd2222222-2222-2222-2222-222222222222', 'staff'),
  ('d0000000-0000-0000-0000-000000000002', 'd3333333-3333-3333-3333-333333333333', 'owner')
on conflict do nothing;

-- Two colleagues in one organisation, both carrying every personal field.
insert into public.staff_profiles (
  id, org_id, user_id, first_name, last_name, active,
  payroll_id, email, phone, start_date, holiday_allowance
) values
  ('d2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'd1111111-1111-1111-1111-111111111111', 'Mel', 'Manager', true,
   'PAY-MANAGER-001', 'mel@example.test', '07700 900001', '2024-01-15', 28),
  ('d2000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001',
   'd2222222-2222-2222-2222-222222222222', 'Sam', 'Staff', true,
   'PAY-STAFF-002', 'sam@example.test', '07700 900002', '2025-06-01', 21);

create or replace function pg_temp.become(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true);
$$;

set local role authenticated;

-- ---------- a staff account sees a colleague, not their record --------
select pg_temp.become('d2222222-2222-2222-2222-222222222222');

select is(
  (select payroll_id from public.staff_profiles_visible
    where id = 'd2000000-0000-0000-0000-000000000001'),
  null::text,
  'staff cannot read a colleague''s payroll id');

select is(
  (select email from public.staff_profiles_visible
    where id = 'd2000000-0000-0000-0000-000000000001'),
  null::text,
  'staff cannot read a colleague''s email address');

select is(
  (select phone from public.staff_profiles_visible
    where id = 'd2000000-0000-0000-0000-000000000001'),
  null::text,
  'staff cannot read a colleague''s phone number');

select is(
  (select start_date from public.staff_profiles_visible
    where id = 'd2000000-0000-0000-0000-000000000001'),
  null::date,
  'staff cannot read a colleague''s start date');

select is(
  (select holiday_allowance from public.staff_profiles_visible
    where id = 'd2000000-0000-0000-0000-000000000001'),
  null::numeric,
  'staff cannot read a colleague''s holiday allowance');

-- The colleague is still THERE. A rota needs their name, and a mask that
-- removed the row would break the product to fix a leak.
select is(
  (select first_name || ' ' || last_name from public.staff_profiles_visible
    where id = 'd2000000-0000-0000-0000-000000000001'),
  'Mel Manager',
  'staff still sees who their colleagues are');

-- ---------- your own record is yours ----------------------------------
select is(
  (select payroll_id from public.staff_profiles_visible
    where id = 'd2000000-0000-0000-0000-000000000002'),
  'PAY-STAFF-002',
  'a person reads their own payroll id');

select is(
  (select email from public.staff_profiles_visible
    where id = 'd2000000-0000-0000-0000-000000000002'),
  'sam@example.test',
  'a person reads their own email address');

select is(
  (select phone from public.staff_profiles_visible
    where id = 'd2000000-0000-0000-0000-000000000002'),
  '07700 900002',
  'a person reads their own phone number');

select is(
  (select holiday_allowance from public.staff_profiles_visible
    where id = 'd2000000-0000-0000-0000-000000000002'),
  21::numeric,
  'a person reads their own holiday allowance, which the leave tiles need');

-- ---------- the direct path is closed, not merely unused ---------------
-- The revoke is what makes this a control. Without it the view is only a
-- politer way to ask the same question.
select throws_ok(
  $$ select payroll_id from public.staff_profiles
      where id = 'd2000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'selecting payroll_id straight from the base table is refused');

-- ---------- a manager keeps the job they are here to do -----------------
select pg_temp.become('d1111111-1111-1111-1111-111111111111');

select is(
  (select payroll_id from public.staff_profiles_visible
    where id = 'd2000000-0000-0000-0000-000000000002'),
  'PAY-STAFF-002',
  'a manager reads their team''s payroll ids');

select is(
  (select email from public.staff_profiles_visible
    where id = 'd2000000-0000-0000-0000-000000000002'),
  'sam@example.test',
  'a manager reads their team''s email addresses');

select is(
  (select phone from public.staff_profiles_visible
    where id = 'd2000000-0000-0000-0000-000000000002'),
  '07700 900002',
  'a manager reads their team''s phone numbers');

select is(
  (select start_date from public.staff_profiles_visible
    where id = 'd2000000-0000-0000-0000-000000000002'),
  '2025-06-01'::date,
  'a manager reads their team''s start dates');

select is(
  (select holiday_allowance from public.staff_profiles_visible
    where id = 'd2000000-0000-0000-0000-000000000002'),
  21::numeric,
  'a manager reads their team''s holiday allowances');

-- ---------- the view is definer-rights: its WHERE is the tenancy guard --
select pg_temp.become('d3333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.staff_profiles_visible
    where org_id = 'd0000000-0000-0000-0000-000000000001'),
  0,
  'an owner of another tenant reads no rows through the view at all');

select * from finish();
rollback;
