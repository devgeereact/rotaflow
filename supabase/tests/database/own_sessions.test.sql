-- =====================================================================
-- own_sessions.test.sql — CAP-050
--
-- The register said "no server-side registry, no per-device revoke".
-- The first half was wrong — `auth.sessions` has carried the user agent,
-- IP and last refresh the whole time. Nothing surfaced it.
--
-- These assertions are almost entirely about the boundary, because the
-- feature reads GoTrue's own table with SECURITY DEFINER and a mistake
-- there hands one person another person's device list:
--
--   1. the caller sees their own sessions;
--   2. and NOT a second account's, even though the function runs as the
--      owner and could read every row in the table;
--   3. the session the JWT names is flagged as current;
--   4. exactly one is;
--   5. revoking removes the others;
--   6. and leaves this one alone — otherwise the person taking a safety
--      action is the one signed out;
--   7. it does not touch anybody else's sessions;
--   8. and returns how many it ended, which is what the screen reports;
--   9. `anon` cannot call either function, so an unauthenticated caller
--  10. cannot enumerate or revoke anything.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('d1111111-1111-1111-1111-111111111111'::uuid, 'mine-sessions@example.test'),
  ('d2222222-2222-2222-2222-222222222222'::uuid, 'theirs-sessions@example.test')
) as v(id, email);

-- Three devices for the caller, one for somebody else.
insert into auth.sessions (id, user_id, created_at, updated_at, refreshed_at, user_agent, ip) values
  ('d1000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111',
   now(), now(), now(), 'Chrome on macOS', '203.0.113.10'),
  ('d1000000-0000-0000-0000-000000000002', 'd1111111-1111-1111-1111-111111111111',
   now(), now(), now() - interval '2 days', 'Mobile Safari on iOS', '203.0.113.11'),
  ('d1000000-0000-0000-0000-000000000003', 'd1111111-1111-1111-1111-111111111111',
   now(), now(), null, 'Ward tablet', null),
  ('d2000000-0000-0000-0000-000000000001', 'd2222222-2222-2222-2222-222222222222',
   now(), now(), now(), 'Somebody else''s laptop', '203.0.113.20');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', 'd1111111-1111-1111-1111-111111111111',
    'role', 'authenticated',
    'session_id', 'd1000000-0000-0000-0000-000000000001')::text,
  true);

select is(
  (select count(*)::int from public.my_sessions()),
  3,
  'the caller sees their own three sessions'
);

select is(
  (select count(*)::int from public.my_sessions()
    where session_id = 'd2000000-0000-0000-0000-000000000001'),
  0,
  'and not the other account''s, though the function could read every row'
);

select ok(
  (select is_current from public.my_sessions()
    where session_id = 'd1000000-0000-0000-0000-000000000001'),
  'the session the JWT names is flagged as current'
);

select is(
  (select count(*)::int from public.my_sessions() where is_current),
  1,
  'exactly one — a device list where two rows say "this device" tells you nothing'
);

select is(
  public.revoke_my_other_sessions(),
  2,
  'revoking reports how many devices it ended'
);

select is(
  (select count(*)::int from public.my_sessions()),
  1,
  'the others are gone'
);

select is(
  (select session_id from public.my_sessions()),
  'd1000000-0000-0000-0000-000000000001'::uuid,
  'and the one left is this device — the person acting is not the one signed out'
);

reset role;

select is(
  (select count(*)::int from auth.sessions
    where user_id = 'd2222222-2222-2222-2222-222222222222'),
  1,
  'somebody else''s session was never in scope'
);

select ok(
  not has_function_privilege('anon', 'public.my_sessions()', 'EXECUTE'),
  'anon cannot enumerate sessions'
);

select ok(
  not has_function_privilege('anon', 'public.revoke_my_other_sessions()', 'EXECUTE'),
  'anon cannot revoke them either'
);

select * from finish();
rollback;
