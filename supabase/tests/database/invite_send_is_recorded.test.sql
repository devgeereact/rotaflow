-- =====================================================================
-- invite_send_is_recorded.test.sql — the contract `0129` put in place.
--
-- `sendInviteEmail` returned `{ sent, reason }` and the screen turned it
-- into a toast. That was the whole record. Reload the page and a
-- delivered invitation and one the SMTP server refused were both simply
-- "pending" — and they need opposite actions, because one is waiting on
-- the invitee and the other on the manager.
--
--   1. a new invitation has never been sent, which is a distinct state
--      from "sent and unanswered";
--   2. a successful send stamps it;
--   3. a failure records a reason and does NOT stamp it;
--   4. a later success clears the stale reason — a solved problem sitting
--      beside a delivered invitation sends somebody chasing nothing;
--   5. a member of another organisation cannot record anything;
--   6. the client cannot write these columns directly, which is why the
--      function exists: `0118` narrowed UPDATE on `invites` to
--      `revoked_at` alone.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('c3111111-1111-1111-1111-111111111111'::uuid, 'send-owner@example.test'),
  ('c3222222-2222-2222-2222-222222222222'::uuid, 'send-outsider@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('c3000000-0000-0000-0000-000000000001', 'Sends A', 'sends-a',
   'c3111111-1111-1111-1111-111111111111', 'starter'),
  ('c3000000-0000-0000-0000-000000000002', 'Sends B', 'sends-b',
   'c3222222-2222-2222-2222-222222222222', 'starter');

insert into public.invites (id, org_id, email, role, token_hash, expires_at)
values ('c3a00000-0000-0000-0000-000000000001',
        'c3000000-0000-0000-0000-000000000001',
        'joiner@example.test', 'staff', 'hash-1',
        timezone('utc', now()) + interval '7 days');

-- ---------- 6. the client cannot write these columns -------------------
select is(
  (select count(*)::int from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'invites'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'
      and column_name in ('last_sent_at', 'send_error')),
  0,
  'the client holds no UPDATE on the delivery columns — the function is the only writer'
);

-- ---------- 1. never sent is its own state -----------------------------
select is(
  (select last_sent_at from public.invites
    where id = 'c3a00000-0000-0000-0000-000000000001'),
  null,
  'a new invitation has never been emailed'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c3111111-1111-1111-1111-111111111111',
                    'role', 'authenticated')::text,
  true);

-- ---------- 3. a failure records why -----------------------------------
select public.record_invite_send(
  'c3a00000-0000-0000-0000-000000000001', false, 'No mailbox is configured.');

select is(
  (select send_error from public.invites
    where id = 'c3a00000-0000-0000-0000-000000000001'),
  'No mailbox is configured.',
  'a failed send records a reason a manager can act on'
);

select is(
  (select last_sent_at from public.invites
    where id = 'c3a00000-0000-0000-0000-000000000001'),
  null,
  'and does not claim it went out'
);

-- A failure with no reason still records one, because "it failed" with no
-- explanation is the state this migration exists to remove.
select public.record_invite_send('c3a00000-0000-0000-0000-000000000001', false);
select isnt(
  (select send_error from public.invites
    where id = 'c3a00000-0000-0000-0000-000000000001'),
  null,
  'a failure with no reason still records something rather than nothing'
);

-- ---------- 2 and 4. a success stamps it and clears the reason ---------
select public.record_invite_send('c3a00000-0000-0000-0000-000000000001', true);

select isnt(
  (select last_sent_at from public.invites
    where id = 'c3a00000-0000-0000-0000-000000000001'),
  null,
  'a successful send is stamped'
);

select is(
  (select send_error from public.invites
    where id = 'c3a00000-0000-0000-0000-000000000001'),
  null,
  'and the stale failure is cleared, so nobody chases a solved problem'
);

-- ---------- 5. another tenant is refused -------------------------------
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c3222222-2222-2222-2222-222222222222',
                    'role', 'authenticated')::text,
  true);

select throws_ok(
  $$select public.record_invite_send(
      'c3a00000-0000-0000-0000-000000000001', true)$$,
  '42501',
  null,
  'an owner of a different organisation cannot record a send'
);

select * from finish();
rollback;
