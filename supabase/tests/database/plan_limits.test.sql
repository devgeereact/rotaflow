-- =====================================================================
-- plan_limits.test.sql — GAP-008: the plan limits actually bite.
--
-- `plans.seat_limit` and `plans.location_limit` shipped in 0023 and were
-- enforced nowhere — not in the database, and not in the UI either. The
-- register's own rule is that a control whose only enforcement is a hidden
-- button is not a control, so 0070 puts it where a direct PostgREST call
-- meets it too.
--
-- What has to hold:
--
--   1. a Starter org is refused its 16th active staff member;
--   2. and its 2nd site;
--   3. an INACTIVE profile does not consume a seat, because that is what
--      the customer's own billing screen counts;
--   4. deactivating someone frees the seat back up;
--   5. Enterprise (null limit) is genuinely uncapped;
--   6. an unrecognised plan code is uncapped rather than fatal — refusing
--      writes over a data-entry mistake would take a tenant's product away.
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
  'e1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
  'owner-e@example.test', 'x', now(), now(), now(),
  '{"provider":"email"}'::jsonb, '{}'::jsonb;

-- Starter: 15 seats, 1 site.
insert into public.organisations (id, name, slug, created_by, plan) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'Org Starter', 'org-starter-lim',
   'e1111111-1111-1111-1111-111111111111', 'starter');

insert into public.locations (org_id, name) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'Site 1');

-- Fill the plan exactly to its limit.
insert into public.staff_profiles (org_id, first_name, last_name)
select 'eeeeeeee-0000-0000-0000-000000000001', 'Staff', n::text
from generate_series(1, 15) as n;

select is(
  (select count(*)::int from public.staff_profiles
    where org_id = 'eeeeeeee-0000-0000-0000-000000000001' and active),
  15,
  'fifteen active staff is allowed — the limit is inclusive, not off by one'
);

-- 1: the sixteenth is refused.
select throws_ok(
  $$insert into public.staff_profiles (org_id, first_name, last_name)
    values ('eeeeeeee-0000-0000-0000-000000000001', 'One', 'TooMany')$$,
  'P0001',
  null,
  'the sixteenth active staff member is refused at the database'
);

-- 2: the second site is refused.
select throws_ok(
  $$insert into public.locations (org_id, name)
    values ('eeeeeeee-0000-0000-0000-000000000001', 'Site 2')$$,
  'P0001',
  null,
  'and a second site on a one-site plan'
);

-- 3: an inactive profile does not consume a seat.
select lives_ok(
  $$insert into public.staff_profiles (org_id, first_name, last_name, active)
    values ('eeeeeeee-0000-0000-0000-000000000001', 'Archived', 'Leaver', false)$$,
  'an inactive profile is allowed past the cap — it is not a seat'
);

-- 4: freeing a seat lets the next person in.
--
-- Deactivating has to be done AS the owner. `staff_profiles_restrict_self_edit`
-- (0042) runs as invoker, and with `auth.uid()` null `has_org_role` is false, so
-- an unauthenticated update reads as someone editing their own profile and is
-- refused. Setting the claim is not a workaround — it is who actually performs
-- this in the product.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

update public.staff_profiles set active = false
 where org_id = 'eeeeeeee-0000-0000-0000-000000000001'
   and last_name = '1';

reset role;
select set_config('request.jwt.claims', '', true);

select lives_ok(
  $$insert into public.staff_profiles (org_id, first_name, last_name)
    values ('eeeeeeee-0000-0000-0000-000000000001', 'Replacement', 'Hire')$$,
  'deactivating someone frees the seat, which is what the billing screen implies'
);

-- 5: Enterprise is uncapped.
insert into public.organisations (id, name, slug, created_by, plan) values
  ('eeeeeeee-0000-0000-0000-000000000002', 'Org Enterprise', 'org-ent-lim',
   'e1111111-1111-1111-1111-111111111111', 'enterprise');

insert into public.staff_profiles (org_id, first_name, last_name)
select 'eeeeeeee-0000-0000-0000-000000000002', 'Ent', n::text
from generate_series(1, 40) as n;

select is(
  (select count(*)::int from public.staff_profiles
    where org_id = 'eeeeeeee-0000-0000-0000-000000000002'),
  40,
  'a null seat_limit is genuinely uncapped — the Enterprise tier''s whole point'
);
select lives_ok(
  $$insert into public.locations (org_id, name)
    values ('eeeeeeee-0000-0000-0000-000000000002', 'Site A'),
           ('eeeeeeee-0000-0000-0000-000000000002', 'Site B')$$,
  'and so is its location limit'
);

-- 6: an unrecognised plan code fails open, not shut.
insert into public.organisations (id, name, slug, created_by, plan) values
  ('eeeeeeee-0000-0000-0000-000000000003', 'Org Renamed', 'org-renamed-lim',
   'e1111111-1111-1111-1111-111111111111', 'plan_that_does_not_exist');

select lives_ok(
  $$insert into public.staff_profiles (org_id, first_name, last_name)
    values ('eeeeeeee-0000-0000-0000-000000000003', 'Still', 'Works')$$,
  'a plan code that resolves to no row is uncapped — a data-entry mistake must not take the product away'
);

select * from finish();
rollback;
