-- =====================================================================
-- invite_write_paths.test.sql — a manager cannot make themselves an owner
-- (docs/SAAS.md GAP-065, closed by 0118)
--
-- The escalation this guards was two HTTP requests: a manager INSERTs an
-- invite for their own address with `role = 'owner'` and a `token_hash`
-- they chose, then calls `accept_invite`, whose
-- `on conflict do update set role = excluded.role` upgrades their existing
-- membership. `create_invite` has always refused to hand out ownership to
-- a non-owner; nothing stopped a caller going round it straight to the
-- table.
--
-- ## Shown to fail on the real defect
--
-- With `0118` reverted and the database rebuilt, assertions 1 and 2 both
-- fail: the manager's insert succeeds and `manager_is_now_owner` reads
-- true. With `0118` applied the insert is refused and the membership is
-- unchanged. So this fails on the bug rather than passing vacuously.
--
-- ## What is deliberately still allowed
--
-- Assertions 4 and 5 exist so a future tightening cannot quietly remove
-- ordinary function: a manager must still be able to invite staff through
-- `create_invite`, and to revoke a pending invite, which is the one direct
-- write the client makes to this table.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(5);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '71717171-7171-7171-7171-717171717171',
  'authenticated', 'authenticated', 'invite-owner@example.com',
  crypt('not-a-real-password', gen_salt('bf')),
  now(), now(), now(), '{}', '{}'
), (
  '00000000-0000-0000-0000-000000000000',
  '72727272-7272-7272-7272-727272727272',
  'authenticated', 'authenticated', 'invite-manager@example.com',
  crypt('not-a-real-password', gen_salt('bf')),
  now(), now(), now(), '{}', '{}'
);

set local role authenticated;

create or replace function pg_temp.become(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true);
$$;

select pg_temp.become('71717171-7171-7171-7171-717171717171');

insert into public.organisations (name, slug, created_by)
values ('Invite Care Ltd', 'invite-care', '71717171-7171-7171-7171-717171717171');

select set_config(
  'test.org',
  (select id::text from public.organisations where slug = 'invite-care'),
  true);

-- The owner adds a manager, the ordinary way.
insert into public.memberships (org_id, user_id, role, status)
values (current_setting('test.org')::uuid,
        '72727272-7272-7272-7272-727272727272', 'manager', 'active');

-- ---------- everything below runs as that manager ----------------------
select pg_temp.become('72727272-7272-7272-7272-727272727272');

-- 1. The escalation itself: writing an owner invite straight to the table.
select throws_ok(
  $$ insert into public.invites (org_id, email, role, token_hash, expires_at)
     values (current_setting('test.org')::uuid,
             'invite-manager@example.com',
             'owner',
             encode(sha256('chosen-by-the-attacker'::bytea), 'hex'),
             timezone('utc', now()) + interval '7 days') $$,
  '42501',
  null,
  'a manager cannot insert an invite row at all'
);

-- 2. And the same through the function that holds the rule.
select throws_ok(
  $$ select public.create_invite(
       current_setting('test.org')::uuid, 'invite-manager@example.com', 'owner') $$,
  '42501',
  null,
  'create_invite refuses to let a manager hand out ownership'
);

-- 3. The membership is untouched by either attempt.
select is(
  (select role from public.memberships
    where org_id = current_setting('test.org')::uuid
      and user_id = '72727272-7272-7272-7272-727272727272'),
  'manager',
  'the manager is still a manager'
);

-- 4. Inviting a staff member still works.
select lives_ok(
  $$ select public.create_invite(
       current_setting('test.org')::uuid, 'new-carer@example.com', 'staff') $$,
  'a manager can still invite a staff member'
);

-- 5. And revoking a pending invite, the one direct write the client makes.
select lives_ok(
  $$ update public.invites
        set revoked_at = timezone('utc', now())
      where org_id = current_setting('test.org')::uuid
        and email = 'new-carer@example.com' $$,
  'a manager can still revoke an invite'
);

select * from finish();
rollback;
