-- =====================================================================
-- notification_deliveries.test.sql — GAP-004: the delivery record.
--
-- `send-notification` computed whether each notification landed and threw
-- the answer away, so nobody could tell whether staff were actually told.
-- 0067 adds the table that keeps it.
--
-- What is worth testing here is not "the insert works" — it is the access
-- boundary, because this table says who was and was not contacted, and the
-- send path writes it with the service_role key. Three things must hold:
--
--   1. a manager sees their own org's record and NOT another org's;
--   2. a staff member sees only their own rows, never a colleague's —
--      whether someone else's email bounced is not their business;
--   3. no client role can write one at all, so a delivery record cannot be
--      fabricated from a browser session.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(11);

-- ---------- fixtures: two organisations, so isolation is testable ------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id, 'authenticated', 'authenticated', u.email, 'x',
  now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'manager-a@example.test'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'staff-a@example.test'),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'staff-a2@example.test'),
  ('44444444-4444-4444-4444-444444444444'::uuid, 'manager-b@example.test')
) as u(id, email);

insert into public.organisations (id, name, slug, created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A', 'org-a-nd', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Org B', 'org-b-nd', '44444444-4444-4444-4444-444444444444');

-- Only the staff. `on_org_created` (0002) already granted each `created_by`
-- an active OWNER membership when the organisations above were inserted, and
-- inserting it again violates memberships_org_id_user_id_key. Owner satisfies
-- has_org_role(['owner','manager']) either way, which is what the read policy
-- checks, so the privileged reader below is that auto-created owner.
insert into public.memberships (org_id, user_id, role, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'staff', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'staff', 'active');

-- Written as the send path does: service_role, bypassing RLS.
insert into public.notification_deliveries (org_id, user_id, channel, status, event_type, detail) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'email',  'sent',    'rota', null),
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'push',   'expired', 'rota', null),
  ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'email',  'failed',  'rota', 'mailbox full'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'in_app', 'sent',    'leave', null);

-- ---------- 1. the shape the send path depends on ---------------------
select has_table('public', 'notification_deliveries', 'the delivery table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.notification_deliveries'::regclass),
  'RLS is enabled — this table names who was contacted'
);

select throws_ok(
  $$insert into public.notification_deliveries (org_id, user_id, channel, status, event_type)
    values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','sms','sent','rota')$$,
  '23514',
  null,
  'sms is refused: there is no SMS provider, so a row claiming one would be fiction'
);

select throws_ok(
  $$insert into public.notification_deliveries (org_id, user_id, channel, status, event_type)
    values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','email','delivered','rota')$$,
  '23514',
  null,
  'an unknown status is refused rather than stored'
);

-- ---------- 2. an owner/manager sees their org, and only their org ----
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*)::int from public.notification_deliveries),
  3,
  'the org''s owner sees all three of org A''s delivery rows'
);
select is(
  (select count(*)::int from public.notification_deliveries
    where org_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  'and none of org B''s — the tenant boundary holds on this table too'
);

-- ---------- 3. a staff member sees only their own --------------------
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*)::int from public.notification_deliveries),
  2,
  'a staff member sees their own two rows'
);
select is(
  (select count(distinct user_id)::int from public.notification_deliveries),
  1,
  'and nobody else''s: whether a colleague''s email bounced is not their business'
);

-- ---------- 4. no client role may write one --------------------------
select throws_ok(
  $$insert into public.notification_deliveries (org_id, user_id, channel, status, event_type)
    values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','email','sent','rota')$$,
  '42501',
  null,
  'a signed-in user cannot fabricate a delivery record saying someone was told'
);
select throws_ok(
  $$update public.notification_deliveries set status = 'sent' where status = 'failed'$$,
  '42501',
  null,
  'nor rewrite a failure into a success'
);

reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
-- Refused by the GRANT, before RLS is consulted at all. This is stronger
-- than "returns no rows": 0056 handed anon full CRUD on every table it
-- touched, inert only because the policies are auth.uid()-based, and a new
-- table deliberately does not inherit that (docs/SAAS.md HARDEN-001).
select throws_ok(
  'select count(*) from public.notification_deliveries',
  '42501',
  null,
  'anon cannot read the table at all — the grant refuses before RLS is reached'
);

select * from finish();
rollback;
