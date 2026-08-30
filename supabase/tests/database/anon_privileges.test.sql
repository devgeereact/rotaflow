-- =====================================================================
-- anon_privileges.test.sql — HARDEN-001 / HARDEN-002: `anon` holds
-- nothing, and `touch_org_activity` is no longer an unauthenticated
-- write.
--
-- 0056 recorded that anon's CRUD grants were "inert, because the
-- policies are auth.uid()-based". That was true of the CRUD grants and
-- untrue of two other things, which 0075 fixes and this file pins:
--
--   * `touch_org_activity` is `security definer`, takes an organisation
--     id and had no membership check, so anyone could set any
--     organisation's `last_activity_at` to now. That column drives
--     `tenantHealth.healthBand` and the console's active-tenant count —
--     the signal support uses to notice churn.
--   * the hosted default ACL grants `arwdDxtm`, so anon also held
--     TRUNCATE, which RLS does not filter.
--
-- The assertions that matter most are 1 and 2. The revokes would still
-- read as "passing" if the guard inside the function were dropped and
-- only the grant remained, because a grant protects the REST route and
-- the guard protects the function — an Edge Function or any
-- authenticated non-member reaches it without touching the grant at all.
--
-- What has to hold:
--
--   1. a non-member cannot move another organisation's last_activity_at;
--   2. a member still can, or the console's activity signal dies;
--   3. anon cannot read a tenant table — refused by the grant, which is
--      stronger than "returns no rows";
--   4. nor the organisations table;
--   5. nor execute a security predicate;
--   6. nor execute touch_org_activity;
--   7. but CAN still preview an invite, which is the whole logged-out
--      surface;
--   8. and `authenticated` still reads its own organisation, which is
--      what a mistake in this migration would break.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id, 'authenticated', 'authenticated', u.email, 'x',
  now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('d1111111-1111-1111-1111-111111111111'::uuid, 'owner-h@example.test'),
  ('d2222222-2222-2222-2222-222222222222'::uuid, 'outsider-h@example.test')
) as u(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('dddddddd-0000-0000-0000-000000000001', 'Org H', 'org-h-anon',
   'd1111111-1111-1111-1111-111111111111', 'business');

-- Old enough that the five-minute throttle cannot be what refuses the write.
update public.organisations
   set last_activity_at = timezone('utc', now()) - interval '30 days'
 where id = 'dddddddd-0000-0000-0000-000000000001';

-- ---------- 1. a signed-in outsider ----------------------------------
-- Authenticated, so the GRANT lets them call it; only the guard inside the
-- function can refuse. That is the case a revoke alone would miss.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd2222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select public.touch_org_activity('dddddddd-0000-0000-0000-000000000001');

reset role;
select set_config('request.jwt.claims', '', true);

select ok(
  (select last_activity_at from public.organisations
    where id = 'dddddddd-0000-0000-0000-000000000001')
    < timezone('utc', now()) - interval '1 day',
  'a non-member cannot make another organisation look active — the signal support reads for churn'
);

-- ---------- 2. the owner ---------------------------------------------
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select public.touch_org_activity('dddddddd-0000-0000-0000-000000000001');

-- 8: checked while still authenticated as the owner. If 0075 had taken a
-- privilege it should not have, this is what would fail.
select is(
  (select count(*)::int from public.organisations
    where id = 'dddddddd-0000-0000-0000-000000000001'),
  1,
  'authenticated still reads its own organisation — the regression this migration could have caused'
);

reset role;
select set_config('request.jwt.claims', '', true);

select ok(
  (select last_activity_at from public.organisations
    where id = 'dddddddd-0000-0000-0000-000000000001')
    > timezone('utc', now()) - interval '1 minute',
  'a member still can, or the console''s activity signal stops working'
);

-- ---------- anon ------------------------------------------------------
set local role anon;

-- Refused by the GRANT, before RLS is consulted. Stronger than "returns no
-- rows": it cannot be re-widened by a policy change.
select throws_ok(
  'select count(*) from public.shifts',
  '42501',
  null,
  'anon cannot read a tenant table at all'
);

select throws_ok(
  'select count(*) from public.organisations',
  '42501',
  null,
  'nor the organisations table'
);

select throws_ok(
  $$select public.is_org_member('dddddddd-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'nor execute a security predicate at /rest/v1/rpc/'
);

select throws_ok(
  $$select public.touch_org_activity('dddddddd-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'nor call touch_org_activity, which was reachable unauthenticated before 0075'
);

-- The one thing that must survive: `/invite/:token` renders who invited
-- someone before they have an account.
select lives_ok(
  $$select * from public.preview_invite('a-token-that-matches-nothing')$$,
  'but can still preview an invite, which is the entire logged-out surface'
);

reset role;

select * from finish();
rollback;
