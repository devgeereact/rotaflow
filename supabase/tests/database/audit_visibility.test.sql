-- =====================================================================
-- audit_visibility.test.sql — BUG-055: 'both' means both.
--
-- 0032 widened `audit_logs.visibility` to accept 'both', reasoning that
-- 0016's read policy "already handles it correctly, admitting an org reader
-- when visibility is not 'platform_only'". It did not — the policy tested
-- `visibility = 'org'`, an equality — so every 'both' row has been readable
-- by platform staff and nobody else since. 0071 fixes the predicate.
--
-- What has to hold after it:
--
--   1. an owner reads a 'both' row for their org (the regression);
--   2. an owner still reads an 'org' row;
--   3. nobody in the tenant reads 'platform_only';
--   4. a manager reads their OWN action but not a colleague's;
--   5. no tenant reads another org's rows at all.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(7);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id, 'authenticated', 'authenticated', u.email, 'x',
  now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('f1111111-1111-1111-1111-111111111111'::uuid, 'owner-f@example.test'),
  ('f2222222-2222-2222-2222-222222222222'::uuid, 'manager-f@example.test'),
  ('f3333333-3333-3333-3333-333333333333'::uuid, 'other-f@example.test'),
  ('f4444444-4444-4444-4444-444444444444'::uuid, 'owner-g@example.test')
) as u(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('ffffffff-0000-0000-0000-000000000001', 'Org F', 'org-f-audit', 'f1111111-1111-1111-1111-111111111111', 'enterprise'),
  ('ffffffff-0000-0000-0000-000000000002', 'Org G', 'org-g-audit', 'f4444444-4444-4444-4444-444444444444', 'enterprise');

insert into public.memberships (org_id, user_id, role, status) values
  ('ffffffff-0000-0000-0000-000000000001', 'f2222222-2222-2222-2222-222222222222', 'manager', 'active'),
  ('ffffffff-0000-0000-0000-000000000001', 'f3333333-3333-3333-3333-333333333333', 'staff',   'active');

-- Written as the triggers do: service_role, bypassing RLS.
insert into public.audit_logs (org_id, actor_user_id, action, entity_type, visibility, scope) values
  ('ffffffff-0000-0000-0000-000000000001', null, 'org.support_access_allowed', 'organisation', 'both',          'org'),
  ('ffffffff-0000-0000-0000-000000000001', null, 'rota.published',             'rota',         'org',           'org'),
  ('ffffffff-0000-0000-0000-000000000001', null, 'platform_role.granted',      'profile',      'platform_only', 'platform'),
  ('ffffffff-0000-0000-0000-000000000001', 'f2222222-2222-2222-2222-222222222222', 'report.exported', 'report', 'org', 'org'),
  ('ffffffff-0000-0000-0000-000000000001', 'f3333333-3333-3333-3333-333333333333', 'timesheet.exported', 'timesheet', 'org', 'org'),
  ('ffffffff-0000-0000-0000-000000000002', null, 'rota.published',             'rota',         'org',           'org');

-- ---------- the owner of Org F ---------------------------------------
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*)::int from public.audit_logs where visibility = 'both'),
  1,
  'the owner can read a visibility=both row — the regression 0032 introduced'
);
-- Scoped to the actions this test inserts. Creating the organisations and
-- memberships above also fires `memberships_audit` (0016), which writes its
-- own org-visible `membership.added` rows — counting everything would be
-- asserting on that trigger rather than on the policy.
select is(
  (select count(*)::int from public.audit_logs
    where visibility = 'org'
      and action in ('rota.published', 'report.exported', 'timesheet.exported')),
  3,
  'and still reads every org-visible row for their organisation'
);
select is(
  (select count(*)::int from public.audit_logs where visibility = 'platform_only'),
  0,
  'platform_only stays platform-only — the fix widens by exactly one value'
);
select is(
  (select count(*)::int from public.audit_logs
    where org_id = 'ffffffff-0000-0000-0000-000000000002'),
  0,
  'and never another organisation''s rows'
);

-- ---------- a manager of Org F ---------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f2222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*)::int from public.audit_logs),
  1,
  'a manager reads their own action, and only that'
);
select is(
  (select action from public.audit_logs),
  'report.exported',
  'which is the one they actually performed'
);

-- ---------- a staff member of Org F ----------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f3333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*)::int from public.audit_logs),
  1,
  'a staff member reads their own action and not a colleague''s'
);

select * from finish();
rollback;
