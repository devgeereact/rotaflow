-- =====================================================================
-- support_csat.test.sql — BUG-060: satisfaction can actually be
-- collected, and only by the right person.
--
-- `rate_support_case` shipped in 0024 and had no caller for the whole of
-- that time, so `support_cases.csat` could never be anything but null
-- and the console's CSAT figure could never be anything but "no data".
-- BUG-060 gives it one, from `/app/help`.
--
-- Giving a function its first caller is the moment its refusals stop
-- being theoretical, so this pins all four of them. 0077 added the
-- score-range one: it used to fall through to the column CHECK and
-- surface as `support_cases_csat_check` violated, which tells a reader
-- nothing about what to send instead.
--
-- What has to hold:
--
--   1. the requester can rate their own resolved case;
--   2. and the score is what gets stored;
--   3. nobody else can rate it, not even a colleague in the same org;
--   4. it cannot be rated before it is resolved;
--   5. a score outside 1-5 is refused in the function's own words,
--      not the column's;
--   6. re-rating replaces the score — a mis-tap should be correctable;
--   7. a blank comment is stored as null, not as an empty string.
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
  ('a1111111-1111-1111-1111-111111111111'::uuid, 'requester-c@example.test'),
  ('a2222222-2222-2222-2222-222222222222'::uuid, 'colleague-c@example.test')
) as u(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org C', 'org-c-csat',
   'a1111111-1111-1111-1111-111111111111', 'business');

insert into public.memberships (org_id, user_id, role, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001',
   'a2222222-2222-2222-2222-222222222222', 'manager', 'active');

-- A reference is `not null unique` with no default, so the test supplies its
-- own rather than borrowing the live sequence — hardcoding one that collides
-- with real data is how Contact-support broke once already.
insert into public.support_cases
  (id, reference, org_id, requester_id, requester_email,
   subject, category, priority, status, resolved_at)
values
  ('acacacac-0000-0000-0000-000000000001', 'TEST-CSAT-1',
   'aaaaaaaa-0000-0000-0000-000000000001', 'a1111111-1111-1111-1111-111111111111',
   'requester-c@example.test',
   'Clock-in fails on the ward tablet', 'bug', 'high', 'resolved',
   timezone('utc', now()) - interval '1 hour'),
  ('acacacac-0000-0000-0000-000000000002', 'TEST-CSAT-2',
   'aaaaaaaa-0000-0000-0000-000000000001', 'a1111111-1111-1111-1111-111111111111',
   'requester-c@example.test',
   'Still being looked at', 'question', 'normal', 'open', null);

-- ---------- the requester -------------------------------------------
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select lives_ok(
  $$select public.rate_support_case('acacacac-0000-0000-0000-000000000001', 4, 'Sorted quickly')$$,
  'the requester can rate their own resolved case'
);

select is(
  (select csat from public.support_cases
    where id = 'acacacac-0000-0000-0000-000000000001'),
  4,
  'and the score is what gets stored'
);

-- 4: before resolution.
select throws_ok(
  $$select public.rate_support_case('acacacac-0000-0000-0000-000000000002', 5)$$,
  '22023',
  null,
  'an unresolved case cannot be rated — there is nothing to rate yet'
);

-- 5: the refusal 0077 added. Previously this fell through to the column
-- CHECK and came back as 23514, naming a constraint rather than a rule.
select throws_ok(
  $$select public.rate_support_case('acacacac-0000-0000-0000-000000000001', 9)$$,
  '22023',
  null,
  'a score outside 1-5 is refused by the function, not by the column constraint'
);

-- 6: re-rating.
select public.rate_support_case('acacacac-0000-0000-0000-000000000001', 2);
select is(
  (select csat from public.support_cases
    where id = 'acacacac-0000-0000-0000-000000000001'),
  2,
  're-rating replaces the score, because a mis-tap should be correctable'
);

-- 7: a blank comment is not an empty string.
select public.rate_support_case('acacacac-0000-0000-0000-000000000001', 3, '   ');
select is(
  (select csat_comment from public.support_cases
    where id = 'acacacac-0000-0000-0000-000000000001'),
  null,
  'a blank comment is stored as null, so "left blank" and "wrote nothing" are the same row'
);

-- ---------- a colleague in the same organisation ---------------------
-- Not a stranger: a manager in the same org, who CAN see the case through
-- `support_cases_select`. Seeing it and rating it are different rights.
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a2222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select throws_ok(
  $$select public.rate_support_case('acacacac-0000-0000-0000-000000000001', 5)$$,
  '42501',
  null,
  'a colleague who can read the case still cannot rate it — the requester answers for their own experience'
);

select * from finish();
rollback;
