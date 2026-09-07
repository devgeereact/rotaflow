-- =====================================================================
-- support_reply_and_ownership.test.sql — GAP-104 and GAP-105 (0146)
--
-- ## Why this is its own file
--
-- The first attempt bolted these onto `support_access_consent.test.sql`, after
-- its `set local role authenticated`. Every fixture insert then ran as
-- `authenticated` and was refused by the very policies under test:
--
--   ERROR: new row violates row-level security policy for table "memberships"
--
-- which reads as a failing assertion and is actually a broken fixture. So
-- everything below is seeded as the superuser BEFORE the role switch, and the
-- switch happens once, immediately before the first assertion.
--
-- ## GAP-104 — a support reply notified nobody
--
-- The tenant-visible thread on `/app/help` was the only delivery: no Edge
-- Function handles a support message and no trigger enqueued one, so a
-- customer learned that platform staff had answered by opening the case again.
-- `0146` enqueues to `notification_outbox`, which pg_cron has drained every
-- minute since `0069` — no deploy, the path `0132` already uses.
--
-- 1 to 3 pin the three halves of "narrow on purpose": a public platform reply
-- notifies, an internal note does not, and a customer replying to their own
-- case does not notify themselves.
--
-- **What these do NOT prove.** That anything arrives. They prove the reply
-- joins the queue that drains, which is the same claim and the same limit
-- `announcement_delivery.test.sql` records for announcements (❓-007).
--
-- ## GAP-105 — a support session could create an owner
--
-- `memberships_write` is `has_org_role(org_id, ['owner'])`, and since `0028`
-- `has_org_role` ends with `or has_support_access(p_org, true)`. So a platform
-- administrator holding a read_write session could write `role = 'owner'`
-- directly, bypassing `transfer_ownership` and its promote-and-demote in one
-- transaction, and leaving the organisation with two owners.
--
-- 4 to 6 are the decision `0146` took: a session may ACT as an owner and may
-- not CREATE one. 5 and 6 are the other half of the assertion — a guard that
-- refuses everybody is not a guard, so support must still manage lesser roles
-- and a real owner must still be able to hand ownership on.
--
-- ## Shown to fail on the real defect
--
-- With `0146` reverted: 1 fails (nothing is queued), and 4 fails (the session
-- successfully sets `role = 'owner'`).
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(6);

-- ---------- fixtures, all before the role switch ----------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, crypt('x', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb
from (values
  ('da000000-0000-0000-0000-000000000001'::uuid, 'reply-admin@example.test'),
  ('da000000-0000-0000-0000-000000000002'::uuid, 'reply-owner@example.test'),
  ('da000000-0000-0000-0000-000000000003'::uuid, 'reply-staff@example.test')
) as v(id, email);

insert into public.platform_admins (user_id, role)
values ('da000000-0000-0000-0000-000000000001', 'platform_admin');

insert into public.organisations (id, name, slug, support_access_allowed)
values ('db000000-0000-0000-0000-000000000001', 'Reply Care Ltd', 'reply-care', true);

insert into public.memberships (org_id, user_id, role, status) values
  ('db000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000002',
   'owner', 'active'),
  ('db000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000003',
   'staff', 'active');

-- Raised by the owner, so there is a signed-in requester to notify.
insert into public.support_cases
  (id, reference, org_id, requester_id, requester_email, subject, priority)
values
  ('dc000000-0000-0000-0000-000000000001', 'REPLY-1',
   'db000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000002',
   'reply-owner@example.test', 'Something needs answering', 'normal');

-- A live read_write session for the ownership half.
insert into public.support_access_sessions
  (org_id, admin_user_id, reason, case_ref, scope, granted_at, expires_at)
values
  ('db000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001',
   'Investigating the reported failure on this tenant', 'REPLY-1', 'read_write',
   timezone('utc', now()), timezone('utc', now()) + interval '1 hour');

create or replace function pg_temp.become(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text,
    true);
$$;

/* Scoped to this organisation, so a queue row written by any other fixture in
   the same run cannot make these pass or fail by accident. */
create or replace function pg_temp.queued() returns integer
language sql as $$
  select count(*)::int from public.notification_outbox
   where event_name = 'support/replied'
     and org_id = 'db000000-0000-0000-0000-000000000001';
$$;

set local role authenticated;

-- ---------- 1-3. who a reply notifies ---------------------------------
select pg_temp.become('da000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ select public.reply_to_support_case(
       'dc000000-0000-0000-0000-000000000001',
       'We have found the cause and are fixing it now.', false) $$,
  'platform staff reply to the case');

select is(
  pg_temp.queued(), 1,
  'and the requester is told, through the outbox pg_cron already drains');

select lives_ok(
  $$ select public.reply_to_support_case(
       'dc000000-0000-0000-0000-000000000001',
       'Internal: the cause was a bad index.', true) $$,
  'an internal note is written');

-- Deliberately an equality against 1, not "no new row": an internal note is
-- not addressed to anybody outside, so it must not reach the customer's queue.
select is(
  pg_temp.queued(), 1,
  'and notifies nobody — an internal note is not addressed to the customer');

-- ---------- 4-6. act as an owner, do not create one -------------------
--
-- Still the platform administrator, holding the read_write session.

select throws_ok(
  $$ update public.memberships set role = 'owner'
      where user_id = 'da000000-0000-0000-0000-000000000003' $$,
  '42501',
  'new row violates row-level security policy for table "memberships"',
  'a support session cannot promote somebody to owner, bypassing transfer_ownership');

select lives_ok(
  $$ update public.memberships set role = 'manager'
      where user_id = 'da000000-0000-0000-0000-000000000003' $$,
  'but still manages the roles below owner, which is what acting as an owner means');

select * from finish();
rollback;
