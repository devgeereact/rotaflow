-- =====================================================================
-- rate_limiting.test.sql — GAP-009: the three things that were unbounded
-- now have a ceiling.
--
-- The assertion that matters most is 7. `consume_rate_limit` takes an
-- arbitrary subject, so if a client role could execute it, the cheapest
-- thing to do with this migration would be to exhaust somebody else's
-- allowance — a limiter that hands out a denial-of-service tool is worse
-- than no limiter. Clients get `consume_my_rate_limit`, which derives
-- the subject from `auth.uid()` and refuses a bucket it does not know.
--
-- What has to hold:
--
--   1. under the limit is allowed;
--   2. at the limit is refused;
--   3. a different subject has its own allowance;
--   4. a different bucket has its own allowance;
--   5. events outside the window do not count, and are pruned;
--   6. an unknown bucket is refused rather than given a free private one;
--   7. the subject-taking limiter is not executable by a client role;
--   8. self-serve org creation is capped;
--   9. the platform-admin path (created_by null) is NOT capped, or
--      somebody onboarding customers for a living hits a limit meant for
--      signup.
--
-- Ten assertions across those nine properties: the window one checks both
-- that old events stop counting and that they are pruned.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(10);

-- 1 and 2: the basic ceiling.
select lives_ok(
  $$select public.consume_rate_limit('t_basic','subject-a',2,interval '1 hour')$$,
  'the first call under the limit is allowed'
);
select public.consume_rate_limit('t_basic','subject-a',2,interval '1 hour');

select throws_ok(
  $$select public.consume_rate_limit('t_basic','subject-a',2,interval '1 hour')$$,
  'P0001',
  null,
  'the third call against a limit of two is refused'
);

-- 3: another subject is unaffected.
select lives_ok(
  $$select public.consume_rate_limit('t_basic','subject-b',2,interval '1 hour')$$,
  'a different subject has its own allowance'
);

-- 4: another bucket is unaffected.
select lives_ok(
  $$select public.consume_rate_limit('t_other','subject-a',2,interval '1 hour')$$,
  'a different bucket has its own allowance'
);

-- 5: the window rolls, and old rows are pruned rather than kept forever.
insert into public.rate_limit_events (bucket, subject, created_at)
values ('t_window','subject-c', timezone('utc', now()) - interval '2 hours'),
       ('t_window','subject-c', timezone('utc', now()) - interval '3 hours');

select lives_ok(
  $$select public.consume_rate_limit('t_window','subject-c',1,interval '1 hour')$$,
  'events outside the window do not count against the limit'
);

select is(
  (select count(*)::int from public.rate_limit_events
    where bucket = 't_window' and subject = 'subject-c'),
  1,
  'and the expired rows are pruned, so the table stays proportional to the window'
);

-- 6: an invented bucket must not become a private unlimited allowance.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000',
  'ba111111-1111-1111-1111-111111111111','authenticated','authenticated',
  'limiter@example.test','x',now(),now(),now(),'{"provider":"email"}'::jsonb,'{}'::jsonb;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub','ba111111-1111-1111-1111-111111111111','role','authenticated')::text,
  true);

select throws_ok(
  $$select public.consume_my_rate_limit('anything_i_like', 999, interval '1 hour')$$,
  '22023',
  null,
  'an unknown bucket is refused — otherwise a caller invents one and has no limit'
);

-- 7: the security property.
select ok(
  not has_function_privilege(
    'authenticated',
    'public.consume_rate_limit(text,text,integer,interval)',
    'EXECUTE'),
  'the subject-taking limiter is NOT callable by a client — naming a subject means exhausting someone else''s allowance'
);

reset role;
select set_config('request.jwt.claims','',true);

-- 8 and 9: organisation creation. Inserted as the table owner, because the
-- trigger is what is under test and RLS is not.
-- Five is the cap, so the sixth self-serve organisation is refused.
insert into public.organisations (name, slug, created_by, plan)
select 'Org ' || n, 'org-limit-' || n, 'ba111111-1111-1111-1111-111111111111', 'starter'
  from generate_series(1,5) as n;

select throws_ok(
  $$insert into public.organisations (name, slug, created_by, plan)
    values ('Org six','org-limit-6','ba111111-1111-1111-1111-111111111111','starter')$$,
  'P0001',
  null,
  'the sixth self-serve organisation in an hour is refused'
);

-- The platform-admin path leaves created_by null and is already role-gated.
select lives_ok(
  $$insert into public.organisations (name, slug, created_by, plan)
    values ('Org admin','org-limit-admin',null,'starter')$$,
  'the platform-admin path is not capped — that limit is for self-serve signup'
);

select * from finish();
rollback;
