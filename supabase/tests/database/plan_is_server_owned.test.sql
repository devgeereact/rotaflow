-- =====================================================================
-- plan_is_server_owned.test.sql — a paid tier follows a paid subscription
-- (docs/SAAS.md GAP-062), and the founder can use their own organisation
-- on day one (GAP-068)
--
-- `organisations.plan` is the entitlement column: `0070` joins
-- `plans p on p.code = o.plan` for `seat_limit` and `location_limit`, and
-- `my_feature_access` reads the same row for `ai_rota_assistant`. It was
-- writable from the browser, and `OnboardingPage` wrote it from a radio
-- button, so choosing Business granted Business. `0120` makes it
-- server-owned; `0121` gives the founder a staff record so the
-- organisation is usable before any of that matters.
--
-- ## Shown to fail on the real defect
--
-- With `0120` reverted, assertion 2 fails: the owner's
-- `update organisations set plan = 'business'` succeeds. With `0121`
-- reverted, assertion 6 fails: no `staff_profiles` row exists for the
-- founder, which is the state every customer was in on day one.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(7);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '81818181-8181-8181-8181-818181818181',
  'authenticated', 'authenticated', 'ada.lovelace@example.com',
  crypt('not-a-real-password', gen_salt('bf')),
  now(), now(), now(), '{}', '{}'
);

update public.profiles set full_name = 'Ada King Lovelace'
 where id = '81818181-8181-8181-8181-818181818181';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '81818181-8181-8181-8181-818181818181', 'role', 'authenticated')::text,
  true);

insert into public.organisations (name, slug, created_by)
values ('Plan Care Ltd', 'plan-care', '81818181-8181-8181-8181-818181818181');

select set_config(
  'test.org',
  (select id::text from public.organisations where slug = 'plan-care'),
  true);

-- ---------- 1. A new organisation is on the free tier ------------------
select is(
  (select plan from public.organisations where id = current_setting('test.org')::uuid),
  'starter',
  'a new organisation starts on the free tier'
);

-- ---------- 2. The owner cannot promote themselves ---------------------
select throws_ok(
  $$ update public.organisations set plan = 'business'
      where id = current_setting('test.org')::uuid $$,
  '42501',
  null,
  'an owner cannot write organisations.plan'
);

-- ---------- 3. Nor smuggle one in at creation --------------------------
select throws_ok(
  $$ insert into public.organisations (name, slug, plan, created_by)
     values ('Sneaky Ltd', 'sneaky-ltd', 'enterprise',
             '81818181-8181-8181-8181-818181818181') $$,
  '42501',
  null,
  'an owner cannot choose a plan when creating an organisation'
);

-- ---------- 4. A paid subscription grants the tier ---------------------
-- Written as the service_role, which is what the Stripe webhook holds.
set local role service_role;

insert into public.subscriptions (org_id, plan, status, provider, provider_ref)
values (current_setting('test.org')::uuid, 'business', 'active', 'stripe', 'sub_test_1');

select is(
  (select plan from public.organisations where id = current_setting('test.org')::uuid),
  'business',
  'an active subscription lifts the organisation onto its plan'
);

-- ---------- 5. Losing it puts them back on the free tier ---------------
update public.subscriptions
   set status = 'canceled'
 where org_id = current_setting('test.org')::uuid;

select is(
  (select plan from public.organisations where id = current_setting('test.org')::uuid),
  'starter',
  'a cancelled subscription falls back to the free tier, not to nothing'
);

-- ---------- 6. The founder has a staff record --------------------------
select is(
  (select first_name || '|' || last_name
     from public.staff_profiles
    where org_id = current_setting('test.org')::uuid
      and user_id = '81818181-8181-8181-8181-818181818181'),
  'Ada|King Lovelace',
  'the founder gets a staff profile, keeping every name after the first'
);

-- ---------- 7. And it is linked, so my_staff_profile_id finds it -------
select isnt(
  (select user_id from public.staff_profiles
    where org_id = current_setting('test.org')::uuid limit 1),
  null,
  'the founder staff profile is linked to their account'
);

select * from finish();
rollback;
