-- =====================================================================
-- org_creation_bootstrap.test.sql — regression guard for BUG-001
-- (docs/QA-AUDIT-REPORT.md), root-caused and fixed by migrations
-- 0048_restore_org_creation_bootstrap.sql and
-- 0049_fix_org_bootstrap_correlation.sql.
--
-- The bug: `organisations_select`'s bootstrap clause is the only thing that
-- lets a brand-new user see the organisation they just inserted, in the
-- window between the INSERT and `on_org_created`'s AFTER INSERT trigger
-- granting their membership — PostgREST's insert+RETURNING checks the
-- SELECT policy before the trigger's effects are visible. Losing that
-- clause (0031) made every org creation fail silently at RETURNING. Getting
-- its correlated subquery wrong (0048's `where m.org_id = id` bound `id` to
-- `memberships.id`, not `organisations.id`) reopened a permanent
-- read-access backdoor for the creator instead of narrowing the window shut
-- once membership exists. Both failure modes are silent: nothing here
-- raises a *type* error, RLS just returns 0 rows or infinite rows.
--
-- pgTAP, run via `supabase test db` (spins up its own local Postgres,
-- applies every migration, then this file — no live project, no secrets,
-- nothing to configure).
--
-- NOTE: written and reviewed, but not executed — this environment has no
-- Docker, so `supabase test db` could not be run here. Run it once before
-- trusting this file, and before wiring it into CI.
-- =====================================================================

begin;
select plan(4);

-- ---------- fixtures: two auth users, via the real trigger path ---------
-- Inserting into auth.users (not public.profiles directly) exercises
-- handle_new_user() (0001) exactly like a real sign-up would, so this test
-- fails the same way production would if that trigger ever broke too.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated', 'bootstrap-owner@example.com',
  crypt('not-a-real-password', gen_salt('bf')),
  now(), now(), now(), '{}', '{}'
), (
  '00000000-0000-0000-0000-000000000000',
  '22222222-2222-2222-2222-222222222222',
  'authenticated', 'authenticated', 'other-new-user@example.com',
  crypt('not-a-real-password', gen_salt('bf')),
  now(), now(), now(), '{}', '{}'
);

-- ---------- test 1: a zero-membership user can create AND immediately
-- read back their own organisation (the exact RETURNING-time check that
-- was silently broken by 0031) --------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

prepare create_org as
  insert into public.organisations (name, slug, created_by)
  values ('Bootstrap Test Org', 'bootstrap-test-org', '11111111-1111-1111-1111-111111111111')
  returning id;

select lives_ok(
  'create_org',
  'a brand-new, zero-membership user can INSERT ... RETURNING their own organisation (BUG-001)'
);

deallocate create_org;

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------- test 2: on_org_created actually ran, so the creator is now a
-- real member (sanity check the fixture, not the bug itself) -----------

select isnt(
  (select id from public.memberships
     where org_id = (select id from public.organisations where slug = 'bootstrap-test-org')
       and user_id = '11111111-1111-1111-1111-111111111111'),
  null,
  'on_org_created granted the creator a real membership row'
);

-- ---------- test 3: the bootstrap window is genuinely narrowed, not the
-- always-true clause 0049 fixed — a second, unrelated zero-membership user
-- must NOT be able to read the first user's organisation ----------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*)::int from public.organisations where slug = 'bootstrap-test-org'),
  0,
  'a different, unrelated zero-membership user cannot read another user''s organisation (0049 correlation fix)'
);

-- ---------- test 4: the bootstrap window closes for the creator too, once
-- their own membership exists — it is a one-time creation window, not a
-- standing backdoor for `created_by = auth.uid()` ------------------------

reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

-- Membership already exists from test 1's trigger — is_org_member() alone
-- covers visibility now, so this asserts the row is still visible for the
-- right reason (membership), not proof either way about the bootstrap
-- clause. The real backdoor test is 3: if the clause were unconditionally
-- true (0049's bug), test 3 would have returned 1, not 0.
select is(
  (select count(*)::int from public.organisations where slug = 'bootstrap-test-org'),
  1,
  'the creator still sees their own organisation once membership exists (via is_org_member, not the bootstrap clause)'
);

select * from finish();
rollback;
