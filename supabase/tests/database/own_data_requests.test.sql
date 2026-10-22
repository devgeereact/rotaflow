-- =====================================================================
-- own_data_requests.test.sql — GAP-057
--
-- `0160` lets a signed-in person file a UK GDPR request for themselves in
-- the `0020` register. Both functions run SECURITY DEFINER, so RLS does
-- not stand between the caller and every row of the register; the bodies
-- must do it. These assertions are almost all about that boundary:
--
--   1. a request is filed for the caller, with the 0020 deadline;
--   2. the subject is the caller's own email, not anything passed in;
--   3. a repeat of the same kind returns the open request, not a second one;
--   4. a request naming an organisation the caller is not in is refused;
--   5. naming the caller's own organisation is accepted;
--   6. a kind the button does not offer is refused;
--   7. the caller sees their own requests;
--   8. and not another person's, though the function could read them all;
--   9. a signed-out caller cannot file one;
--  10. `anon` can execute neither function.
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
  ('e1111111-1111-1111-1111-111111111111'::uuid, 'Me-Data@Example.test'),
  ('e2222222-2222-2222-2222-222222222222'::uuid, 'them-data@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('e9000000-0000-0000-0000-000000000001', 'Org Mine', 'org-own-data-mine',
   'e1111111-1111-1111-1111-111111111111', 'enterprise'),
  ('e9000000-0000-0000-0000-000000000002', 'Org Theirs', 'org-own-data-theirs',
   'e2222222-2222-2222-2222-222222222222', 'enterprise');

insert into public.memberships (org_id, user_id, role) values
  ('e9000000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-111111111111', 'staff')
on conflict do nothing;

-- Somebody else already has a request open.
insert into public.gdpr_requests (id, subject_email, kind, received_on, due_on) values
  ('e8000000-0000-0000-0000-000000000001', 'them-data@example.test', 'access', current_date, (current_date + interval '1 month')::date);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

select is(
  (select due_on from public.request_my_data('access')),
  (current_date + interval '1 month')::date,
  'a request is filed for the caller with the one-month deadline'
);

select is(
  (select count(*)::int from public.my_data_requests() where kind = 'access'),
  1,
  'and it is the caller''s, matched on their own email whatever its case'
);

select ok(
  (select already_open from public.request_my_data('access')),
  'asking again while it is open returns the open request'
);

select throws_ok(
  $$ select * from public.request_my_data('erasure', 'e9000000-0000-0000-0000-000000000002') $$,
  '42501',
  'You are not a member of that organisation',
  'a request cannot name an organisation the caller is not in'
);

select is(
  (select already_open from public.request_my_data('erasure', 'e9000000-0000-0000-0000-000000000001')),
  false,
  'naming the caller''s own organisation is accepted'
);

select throws_ok(
  $$ select * from public.request_my_data('objection') $$,
  '22023',
  'That kind of request cannot be made here',
  'a kind the page does not offer is refused'
);

select is(
  (select count(*)::int from public.my_data_requests()),
  2,
  'the caller sees their own two requests'
);

select is(
  (select count(*)::int from public.my_data_requests()
    where id = 'e8000000-0000-0000-0000-000000000001'),
  0,
  'and not somebody else''s, though the function could read every row'
);

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);

select throws_ok(
  $$ select * from public.request_my_data('access') $$,
  '42501',
  'Sign in to ask for your data',
  'a caller with no user cannot file a request'
);

reset role;

select ok(
  not has_function_privilege('anon', 'public.request_my_data(text, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.my_data_requests()', 'EXECUTE'),
  'anon can execute neither function'
);

select * from finish();
rollback;
