-- =====================================================================
-- org_rate_limit.test.sql — HARDEN-004: an organisation's AI spend has a
-- ceiling, and naming the organisation does not become a lever on
-- somebody else's.
--
-- `consume_org_rate_limit` (0089) is the only limiter that takes its
-- subject as an argument AND is callable by a client. That combination
-- is what the tests below are about: 0085 revoked the general
-- subject-taking limiter from every client role precisely because a
-- caller who names a subject can exhaust an allowance that is not
-- theirs. This one is safe only because it checks membership first, so
-- that check is the assertion that matters.
--
--   1. a call inside the limit is allowed;
--   2. the call past the limit is refused;
--   3. two organisations do not share a bucket, or one busy tenant
--      throttles another;
--   4. a NON-MEMBER naming somebody else's org is refused — the whole
--      basis for letting a client name a subject at all;
--   5. an unknown bucket is refused, or an invented name is an
--      unlimited private allowance;
--   6. an unauthenticated caller is refused.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(6);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('ea111111-1111-1111-1111-111111111111'::uuid, 'owner-a-limit@example.test'),
  ('eb222222-2222-2222-2222-222222222222'::uuid, 'owner-b-limit@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('eeeeeeee-0000-0000-0000-00000000000a', 'Org A', 'org-a-limit',
   'ea111111-1111-1111-1111-111111111111', 'enterprise'),
  ('eeeeeeee-0000-0000-0000-00000000000b', 'Org B', 'org-b-limit',
   'eb222222-2222-2222-2222-222222222222', 'enterprise');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'ea111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

-- A limit of two, so the third call is the one that must fail.
select lives_ok(
  $$select public.consume_org_rate_limit('ai_assistant_org','eeeeeeee-0000-0000-0000-00000000000a', 2, interval '1 hour')$$,
  'a call inside the organisation''s limit is allowed');

select public.consume_org_rate_limit(
  'ai_assistant_org', 'eeeeeeee-0000-0000-0000-00000000000a', 2, interval '1 hour');

select throws_ok(
  $$select public.consume_org_rate_limit('ai_assistant_org','eeeeeeee-0000-0000-0000-00000000000a', 2, interval '1 hour')$$,
  'P0001',
  null,
  'the call past the organisation''s limit is refused');

-- Org B's owner, whose organisation has spent nothing.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'eb222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true);

select lives_ok(
  $$select public.consume_org_rate_limit('ai_assistant_org','eeeeeeee-0000-0000-0000-00000000000b', 2, interval '1 hour')$$,
  'one organisation exhausting its allowance does not throttle another');

-- The same caller, now naming an organisation they are not a member of.
select throws_ok(
  $$select public.consume_org_rate_limit('ai_assistant_org','eeeeeeee-0000-0000-0000-00000000000a', 2, interval '1 hour')$$,
  '42501',
  'Not permitted',
  'a non-member cannot spend another organisation''s allowance');

select throws_ok(
  $$select public.consume_org_rate_limit('made_up','eeeeeeee-0000-0000-0000-00000000000b', 2, interval '1 hour')$$,
  '22023',
  null,
  'an invented bucket is refused, not given its own unlimited allowance');

select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$select public.consume_org_rate_limit('ai_assistant_org','eeeeeeee-0000-0000-0000-00000000000b', 2, interval '1 hour')$$,
  '28000',
  'Not authenticated',
  'an unauthenticated caller is refused');

reset role;
select * from finish();
rollback;
