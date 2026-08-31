-- =====================================================================
-- ownership_and_duplicates.test.sql — 0095 (CAP-091, CAP-092)
--
-- OWNERSHIP TRANSFER. Doing this by hand needs promote-then-demote:
-- `memberships_keep_one_owner` (0047) refuses the other order, because an
-- organisation with no owner is unrecoverable. That leaves two owners in
-- between, and stays that way if the second step is forgotten.
--
--   1. an owner can hand over;
--   2. the new owner is an owner;
--   3. the outgoing owner becomes a MANAGER, not nothing — losing your
--      own access as a side effect of handing over is a surprise;
--   4. there is exactly ONE owner afterwards, which is the whole point:
--      the half-finished manual sequence leaves two;
--   5. a manager cannot transfer — that would be escalation with extra
--      steps;
--   6. an organisation cannot be handed to somebody who is not in it.
--      `memberships_keep_one_owner` cannot catch this: it guards against
--      removing the last owner, not against naming a stranger, so
--      without the check the promote does nothing and the demote leaves
--      the organisation ownerless.
--
-- DUPLICATES.
--
--   7. one account cannot hold two staff records in one organisation —
--      a second splits that person's clock-ins, timesheets and leave,
--      and `my_staff_profile_id` picks between them arbitrarily;
--   8. the same person CAN exist in two different organisations, which
--      is a normal thing for an agency worker;
--   9. a payroll id still cannot repeat — that came from 0041, not from
--      0095, and is asserted because 0095 deliberately did NOT add a
--      second index over the same columns;
--  10. two sites cannot share a name, case-insensitively.
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
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('c9111111-1111-1111-1111-111111111111'::uuid, 'owner-transfer@example.test'),
  ('c9222222-2222-2222-2222-222222222222'::uuid, 'manager-transfer@example.test'),
  ('c9333333-3333-3333-3333-333333333333'::uuid, 'outsider-transfer@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('c9000000-0000-0000-0000-000000000001', 'Org Transfer', 'org-transfer',
   'c9111111-1111-1111-1111-111111111111', 'starter'),
  ('c9000000-0000-0000-0000-000000000002', 'Org Second', 'org-second',
   'c9111111-1111-1111-1111-111111111111', 'starter');

insert into public.memberships (org_id, user_id, role) values
  ('c9000000-0000-0000-0000-000000000001', 'c9222222-2222-2222-2222-222222222222', 'manager')
on conflict do nothing;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c9111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

select lives_ok(
  $$select public.transfer_ownership(
      'c9000000-0000-0000-0000-000000000001',
      'c9222222-2222-2222-2222-222222222222')$$,
  'an owner can hand the organisation over'
);

select is(
  (select role from public.memberships
    where org_id = 'c9000000-0000-0000-0000-000000000001'
      and user_id = 'c9222222-2222-2222-2222-222222222222'),
  'owner',
  'the new owner is an owner'
);

select is(
  (select role from public.memberships
    where org_id = 'c9000000-0000-0000-0000-000000000001'
      and user_id = 'c9111111-1111-1111-1111-111111111111'),
  'manager',
  'and the outgoing owner is a manager, not removed'
);

select is(
  (select count(*)::int from public.memberships
    where org_id = 'c9000000-0000-0000-0000-000000000001' and role = 'owner'),
  1,
  'exactly one owner — the half-finished manual sequence leaves two'
);

-- The caller is now a manager, so this is also the manager case.
select throws_ok(
  $$select public.transfer_ownership(
      'c9000000-0000-0000-0000-000000000001',
      'c9333333-3333-3333-3333-333333333333')$$,
  '42501',
  'Only an owner can transfer an organisation',
  'a manager cannot transfer the organisation'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c9222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true);

select throws_ok(
  $$select public.transfer_ownership(
      'c9000000-0000-0000-0000-000000000001',
      'c9333333-3333-3333-3333-333333333333')$$,
  '22023',
  'That person is not an active member of this organisation',
  'and it cannot be handed to somebody who is not a member'
);

reset role;
select set_config('request.jwt.claims', '', true);

-- ── duplicates ────────────────────────────────────────────────────────
insert into public.staff_profiles (id, org_id, user_id, first_name, last_name) values
  ('c9200000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001',
   'c9333333-3333-3333-3333-333333333333', 'Sarah', 'Jones');

select throws_ok(
  $$insert into public.staff_profiles (org_id, user_id, first_name, last_name)
    values ('c9000000-0000-0000-0000-000000000001',
            'c9333333-3333-3333-3333-333333333333', 'Sarah', 'Jones')$$,
  '23505',
  null,
  'one account cannot hold two staff records in the same organisation'
);

select lives_ok(
  $$insert into public.staff_profiles (org_id, user_id, first_name, last_name)
    values ('c9000000-0000-0000-0000-000000000002',
            'c9333333-3333-3333-3333-333333333333', 'Sarah', 'Jones')$$,
  'but the same person can work for two organisations — normal for agency staff'
);

-- Payroll ids were ALREADY unique per organisation, from 0041 — which
-- CAP-092 ("no check on staff or locations") did not know. Asserted here
-- because 0095 deliberately did not add a second index over the same
-- columns, and the reason should be visible if somebody wonders why not.
insert into public.staff_profiles (org_id, first_name, last_name, payroll_id) values
  ('c9000000-0000-0000-0000-000000000001', 'Payroll', 'One', 'EMP-001');

select throws_ok(
  $$insert into public.staff_profiles (org_id, first_name, last_name, payroll_id)
    values ('c9000000-0000-0000-0000-000000000001', 'Different', 'Person', 'EMP-001')$$,
  '23505',
  null,
  'a payroll id still cannot repeat in an organisation — 0041, not this migration'
);

insert into public.locations (org_id, name, timezone) values
  ('c9000000-0000-0000-0000-000000000001', 'Ward A', 'Europe/London');

select throws_ok(
  $$insert into public.locations (org_id, name, timezone)
    values ('c9000000-0000-0000-0000-000000000001', 'ward a', 'Europe/London')$$,
  '23505',
  null,
  'and two sites cannot share a name, whatever the capitalisation'
);

select * from finish();
rollback;
