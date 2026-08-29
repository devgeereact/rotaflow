-- =====================================================================
-- notification_outbox.test.sql — GAP-026: the publish carries its own
-- notification.
--
-- Until 0069 the browser announced a rota publication. #166 made that
-- retry, but nothing could survive the tab being closed before the outbox
-- write flushed — the publish landed and no record anywhere said a
-- notification was owed.
--
-- The trigger runs inside the publishing transaction, so what has to hold
-- is that the enqueue is tied to the publish and to nothing else:
--
--   1. publishing enqueues exactly one row, addressed to the people who
--      actually hold a shift in that rota;
--   2. a staff_profile with no login is not listed as a recipient, because
--      there is nobody to notify;
--   3. a cancelled shift does not drag its holder in;
--   4. archiving the superseded rota does NOT enqueue a second one — those
--      staff are being told about the revision, not about history;
--   5. an update that does not change status enqueues nothing;
--   6. the queue is org-scoped to owners and managers like everything else.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id, 'authenticated', 'authenticated', u.email, 'x',
  now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('d1111111-1111-1111-1111-111111111111'::uuid, 'owner-d@example.test'),
  ('d2222222-2222-2222-2222-222222222222'::uuid, 'rostered-d@example.test'),
  ('d3333333-3333-3333-3333-333333333333'::uuid, 'cancelled-d@example.test')
) as u(id, email);

insert into public.organisations (id, name, slug, created_by) values
  ('dddddddd-0000-0000-0000-000000000001', 'Org D', 'org-d-outbox', 'd1111111-1111-1111-1111-111111111111');

insert into public.memberships (org_id, user_id, role, status) values
  ('dddddddd-0000-0000-0000-000000000001', 'd2222222-2222-2222-2222-222222222222', 'staff', 'active'),
  ('dddddddd-0000-0000-0000-000000000001', 'd3333333-3333-3333-3333-333333333333', 'staff', 'active');

insert into public.locations (id, org_id, name) values
  ('dddddddd-1000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'Site D');

-- Three staff: one rostered with a login, one rostered whose shift is
-- cancelled, and one rostered with NO login at all.
insert into public.staff_profiles (id, org_id, user_id, first_name, last_name) values
  ('dddddddd-2000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   'd2222222-2222-2222-2222-222222222222', 'Rosie', 'Rostered'),
  ('dddddddd-2000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001',
   'd3333333-3333-3333-3333-333333333333', 'Cal', 'Cancelled'),
  ('dddddddd-2000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000001',
   null, 'Noel', 'Nologin');

insert into public.rotas (id, org_id, location_id, name, period_start, period_end) values
  ('dddddddd-3000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   'dddddddd-1000-0000-0000-000000000001', 'Week 1', date '2026-09-07', date '2026-09-13');

insert into public.shifts (org_id, rota_id, location_id, staff_profile_id, starts_at, ends_at, status) values
  ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-3000-0000-0000-000000000001',
   'dddddddd-1000-0000-0000-000000000001', 'dddddddd-2000-0000-0000-000000000001',
   '2026-09-08 07:00+00', '2026-09-08 15:00+00', 'assigned'),
  ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-3000-0000-0000-000000000001',
   'dddddddd-1000-0000-0000-000000000001', 'dddddddd-2000-0000-0000-000000000002',
   '2026-09-09 07:00+00', '2026-09-09 15:00+00', 'cancelled'),
  ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-3000-0000-0000-000000000001',
   'dddddddd-1000-0000-0000-000000000001', 'dddddddd-2000-0000-0000-000000000003',
   '2026-09-10 07:00+00', '2026-09-10 15:00+00', 'assigned');

select is(
  (select count(*)::int from public.notification_outbox),
  0,
  'a draft rota with shifts on it has enqueued nothing'
);

-- 5: an update that leaves status alone must not enqueue.
update public.rotas set name = 'Week 1 (renamed)'
 where id = 'dddddddd-3000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.notification_outbox),
  0,
  'renaming a rota enqueues nothing — only a status change to published does'
);

-- 1: publish. auth.uid() is null here, so 0061's status guard stands down,
-- which is the same exemption the retention job relies on.
update public.rotas set status = 'published', published_at = timezone('utc', now())
 where id = 'dddddddd-3000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.notification_outbox),
  1,
  'publishing enqueues exactly one notification'
);
select is(
  (select event_name from public.notification_outbox),
  'rota/published',
  'under the event name send-notification already understands'
);
select is(
  (select payload->>'type' from public.notification_outbox),
  'rota',
  'and the payload type the org notification matrix keys off'
);

-- 2 & 3: recipients.
select is(
  (select jsonb_array_length(payload->'userIds') from public.notification_outbox),
  1,
  'one recipient: the cancelled shift and the login-less staff member are both excluded'
);
select is(
  (select payload->'userIds'->>0 from public.notification_outbox),
  'd2222222-2222-2222-2222-222222222222',
  'and it is the person actually holding a live shift'
);

-- 4: archiving the superseded rota must not enqueue a second notification.
update public.rotas set status = 'archived', archived_at = timezone('utc', now())
 where id = 'dddddddd-3000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.notification_outbox),
  1,
  'archiving enqueues nothing — staff hear about the revision, not about history'
);

-- 6: the queue is readable by the org's managers, and by nobody else.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select is(
  (select count(*)::int from public.notification_outbox),
  1,
  'the owner can see what is queued for their org'
);

reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd2222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
select is(
  (select count(*)::int from public.notification_outbox),
  0,
  'a staff member cannot read the org''s notification queue'
);

select * from finish();
rollback;
