-- =====================================================================
-- feature_entitlements.test.sql — CAP-038: the entitlement functions
-- answer for your own organisation, and nobody else's.
--
-- `org_has_feature` and `my_feature_access` are both `security definer`
-- and both take an organisation id. Until 0074 neither checked that the
-- caller belonged to it, so any signed-in user could read which plan
-- tier any tenant was on, by id — RLS on `organisations` does not apply
-- inside a definer function. That sat unexploited because neither
-- function had a caller. CAP-038 gives them callers, so the guard goes
-- in first.
--
-- The assertion that matters most here is 6. 0074's guard is
-- `is_org_member`, and 0028 redefined that to mean "a member, OR a
-- platform administrator holding an active support-access session" —
-- "being a platform administrator is no longer sufficient on its own".
-- Writing `or is_platform_admin()` into 0074 would have looked like
-- belt-and-braces and would in fact have re-opened the standing back
-- door 0028 exists to close, on a function about to be called on every
-- page load. Tests 6 and 7 are what stop that being reintroduced.
--
-- What has to hold:
--
--   1. a member reads their own organisation's plan entitlement;
--   2. and gets false for another organisation, even for a feature that
--      organisation genuinely has;
--   3. `my_feature_access` reports the feature and says the plan grants it;
--   4. and returns nothing at all for a non-member;
--   5. the platform grant actually took effect (so 6 tests something);
--   6. a platform admin with NO support session gets nothing either;
--   7. the same admin, with a session, gets the answer;
--   8. the tier boundary is real — Professional has no assistant;
--   9. and the guard is not simply refusing everything.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id, 'authenticated', 'authenticated', u.email, 'x',
  now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('c1111111-1111-1111-1111-111111111111'::uuid, 'owner-business@example.test'),
  ('c2222222-2222-2222-2222-222222222222'::uuid, 'owner-professional@example.test'),
  ('c3333333-3333-3333-3333-333333333333'::uuid, 'platform@example.test')
) as u(id, email);

-- `platform_admins` is the source of truth (0015); its `platform_admins_sync`
-- trigger mirrors the coarse `profiles.is_platform_admin` flag that
-- `is_platform_admin()` actually reads. Granting through the table rather than
-- setting the flag by hand is the path the product uses, so this test breaks if
-- that mirror ever stops working — which is worth knowing here, since the whole
-- point below is what a platform admin can and cannot reach.
--
-- The profile row it references is created by 0001's `on_auth_user_created`
-- trigger. There is no `active` column; a live grant is `revoked_at is null`.
insert into public.platform_admins (user_id, role)
values ('c3333333-3333-3333-3333-333333333333', 'platform_admin');

-- 0030 put `ai_rota_assistant` on business and enterprise only, and
-- `advanced_reporting` on professional and above. The second org is
-- Professional rather than Starter because these tests need a plan that
-- INCLUDES something and EXCLUDES something else: after 0090 removed
-- `gps_clock_in` from every plan, Starter's feature array is empty, and an org
-- with no entitlements at all cannot show that a refusal is a real check
-- rather than a blanket no.
insert into public.organisations (id, name, slug, created_by, plan) values
  ('cccccccc-0000-0000-0000-000000000001', 'Org Business', 'org-business-ent',
   'c1111111-1111-1111-1111-111111111111', 'business'),
  ('cccccccc-0000-0000-0000-000000000002', 'Org Professional', 'org-professional-ent',
   'c2222222-2222-2222-2222-222222222222', 'professional');

-- ---------- the Business owner ---------------------------------------
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select ok(
  public.org_has_feature('cccccccc-0000-0000-0000-000000000001', 'ai_rota_assistant'),
  'a Business org has the AI assistant, which is what 0030''s plans.features says'
);

select ok(
  not public.org_has_feature('cccccccc-0000-0000-0000-000000000002', 'advanced_reporting'),
  'and cannot read another organisation''s entitlements, even one that is true'
);

select ok(
  (select count(*) > 0 from public.my_feature_access('cccccccc-0000-0000-0000-000000000001')
    where feature = 'ai_rota_assistant' and source = 'plan'),
  'my_feature_access reports it, and says the plan is what grants it'
);

select is(
  (select count(*)::int from public.my_feature_access('cccccccc-0000-0000-0000-000000000002')),
  0,
  'and returns nothing at all for an organisation the caller is not in'
);

-- ---------- a platform admin with no support session ------------------
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c3333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select ok(
  (select is_platform_admin from public.profiles
    where id = 'c3333333-3333-3333-3333-333333333333'),
  'the platform_admins grant reached profiles.is_platform_admin, so the next assertion is testing a real admin'
);

select ok(
  not public.org_has_feature('cccccccc-0000-0000-0000-000000000001', 'ai_rota_assistant'),
  'a platform admin with no support session reads nothing — 0028 removed standing access, and 0074 must not hand it back'
);

-- ---------- the same admin, with a session ----------------------------
-- Inserted as the table owner rather than through `request_support_access`,
-- because the point under test is the entitlement guard, not how a session is
-- granted. `has_support_access` reads this row either way.
reset role;
select set_config('request.jwt.claims', '', true);

insert into public.support_access_sessions
  (org_id, admin_user_id, reason, case_ref, scope, expires_at)
values
  ('cccccccc-0000-0000-0000-000000000001',
   'c3333333-3333-3333-3333-333333333333',
   'Investigating why the assistant is unavailable for this customer',
   'CASE-1041', 'read', timezone('utc', now()) + interval '1 hour');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c3333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select ok(
  public.org_has_feature('cccccccc-0000-0000-0000-000000000001', 'ai_rota_assistant'),
  'with an active session they can, which is how support answers "why can this customer not see it"'
);

-- ---------- the Professional owner -----------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c2222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

-- The boundary the Edge Function now enforces. Without it the whole change is
-- decorative: every tier could call the assistant, and every call spends money
-- at OpenRouter.
select ok(
  not public.org_has_feature('cccccccc-0000-0000-0000-000000000002', 'ai_rota_assistant'),
  'Professional does not include the AI assistant'
);
select ok(
  public.org_has_feature('cccccccc-0000-0000-0000-000000000002', 'advanced_reporting'),
  'but does include advanced reporting, so the guard is not simply refusing everything'
);

-- 0090 removed `gps_clock_in` from every plan: every plan had it, so a gate on
-- it could never refuse anything, and a name in `plans.features` that nothing
-- checks reads as enforcement to the next person. It now resolves to false,
-- which is the better trap — it fails visibly if somebody wires it up.
select ok(
  not public.org_has_feature('cccccccc-0000-0000-0000-000000000002', 'gps_clock_in'),
  'gps_clock_in is not an entitlement any more: it is part of the product'
);

select * from finish();
rollback;
