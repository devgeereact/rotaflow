-- =====================================================================
-- scheduled_alerts.test.sql — GAP-013: a missed clock-in and an
-- expiring document reach somebody without a dashboard being open.
--
-- Both facts were computed on render, so the alert only existed while
-- somebody was looking at the screen it appeared on. Nobody is looking
-- at 06:00, which is when a missed clock-in happens.
--
-- The assertions, and why each is a way this could be wrong:
--
--   1. a shift 45 minutes late with no clock-in enqueues one alert;
--   2. running the job AGAIN enqueues nothing. This is the assertion
--      the whole design hangs on: a job every fifteen minutes without
--      dedupe sends the same alert 48 times, which trains a manager to
--      mute the channel — and then the alert that mattered is muted;
--   3. someone who DID clock in produces no alert;
--   4. a cancelled shift produces none, or a manager is chased about a
--      shift they themselves called off;
--   5. a shift 13 hours late produces none — that is a timesheet
--      problem, and it is the ceiling `findMissedClockIns` already uses;
--   6. the alert is addressed to the owner/manager, NOT to the staff
--      member: it needs somebody who can ring them;
--   7. a document expiring inside 30 days enqueues one alert;
--   8. one that lapsed two months ago does NOT — it is history, not
--      news, and without that floor the first run would enqueue every
--      expired document ever recorded;
--   9. `enqueue_scheduled_alerts` is not callable by a signed-in user.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('aa111111-1111-1111-1111-111111111111'::uuid, 'owner-alerts@example.test'),
  ('aa222222-2222-2222-2222-222222222222'::uuid, 'staff-alerts@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('aaaaaaaa-9000-0000-0000-000000000001', 'Org Alerts', 'org-alerts',
   'aa111111-1111-1111-1111-111111111111', 'starter');

insert into public.locations (id, org_id, name, timezone) values
  ('aaaaaaaa-9100-0000-0000-000000000001', 'aaaaaaaa-9000-0000-0000-000000000001',
   'Ward A', 'Europe/London');

insert into public.staff_profiles (id, org_id, user_id, first_name, last_name, active) values
  ('aaaaaaaa-9200-0000-0000-000000000001', 'aaaaaaaa-9000-0000-0000-000000000001',
   'aa222222-2222-2222-2222-222222222222', 'Ada', 'Late', true),
  ('aaaaaaaa-9200-0000-0000-000000000002', 'aaaaaaaa-9000-0000-0000-000000000001',
   null, 'Bo', 'Punctual', true);

-- Times are relative to now(), so the test does not rot as the clock moves.
insert into public.shifts
  (id, org_id, location_id, staff_profile_id, starts_at, ends_at, status)
values
  -- 45 minutes late, nobody clocked in.
  ('aaaaaaaa-9300-0000-0000-000000000001', 'aaaaaaaa-9000-0000-0000-000000000001',
   'aaaaaaaa-9100-0000-0000-000000000001', 'aaaaaaaa-9200-0000-0000-000000000001',
   timezone('utc', now()) - interval '45 minutes',
   timezone('utc', now()) + interval '7 hours', 'assigned'),
  -- Also late, but this person clocked in.
  ('aaaaaaaa-9300-0000-0000-000000000002', 'aaaaaaaa-9000-0000-0000-000000000001',
   'aaaaaaaa-9100-0000-0000-000000000001', 'aaaaaaaa-9200-0000-0000-000000000002',
   timezone('utc', now()) - interval '45 minutes',
   timezone('utc', now()) + interval '7 hours', 'assigned'),
  -- Late and cancelled.
  ('aaaaaaaa-9300-0000-0000-000000000003', 'aaaaaaaa-9000-0000-0000-000000000001',
   'aaaaaaaa-9100-0000-0000-000000000001', 'aaaaaaaa-9200-0000-0000-000000000002',
   timezone('utc', now()) - interval '45 minutes',
   timezone('utc', now()) + interval '7 hours', 'cancelled'),
  -- Thirteen hours late: past the ceiling.
  ('aaaaaaaa-9300-0000-0000-000000000004', 'aaaaaaaa-9000-0000-0000-000000000001',
   'aaaaaaaa-9100-0000-0000-000000000001', 'aaaaaaaa-9200-0000-0000-000000000001',
   timezone('utc', now()) - interval '13 hours',
   timezone('utc', now()) - interval '5 hours', 'assigned');

insert into public.clock_events (org_id, staff_profile_id, type, event_at) values
  ('aaaaaaaa-9000-0000-0000-000000000001', 'aaaaaaaa-9200-0000-0000-000000000002',
   'in', timezone('utc', now()) - interval '40 minutes');

insert into public.documents (org_id, staff_profile_id, type, name, file_url, expires_at) values
  ('aaaaaaaa-9000-0000-0000-000000000001', 'aaaaaaaa-9200-0000-0000-000000000001',
   'dbs', 'DBS check', 'https://example.test/dbs.pdf', current_date + 10),
  ('aaaaaaaa-9000-0000-0000-000000000001', 'aaaaaaaa-9200-0000-0000-000000000001',
   'training', 'Manual handling', 'https://example.test/mh.pdf', current_date - 60);

select public.enqueue_scheduled_alerts();

select is(
  (select count(*)::int from public.notification_outbox
    where dedupe_key = 'missed_clock_in:aaaaaaaa-9300-0000-0000-000000000001'),
  1,
  'a shift 45 minutes late with no clock-in enqueues one alert'
);

-- The assertion the design hangs on.
select public.enqueue_scheduled_alerts();

select is(
  (select count(*)::int from public.notification_outbox
    where event_name = 'alert/missed_clock_in'),
  1,
  'running the job again enqueues nothing — 48 copies a day is worse than no alert'
);

select is(
  (select count(*)::int from public.notification_outbox
    where dedupe_key = 'missed_clock_in:aaaaaaaa-9300-0000-0000-000000000002'),
  0,
  'somebody who did clock in is not chased'
);

select is(
  (select count(*)::int from public.notification_outbox
    where dedupe_key = 'missed_clock_in:aaaaaaaa-9300-0000-0000-000000000003'),
  0,
  'a cancelled shift raises nothing — nobody is chased about a shift that was called off'
);

select is(
  (select count(*)::int from public.notification_outbox
    where dedupe_key = 'missed_clock_in:aaaaaaaa-9300-0000-0000-000000000004'),
  0,
  'and a shift 13 hours late is a timesheet problem, not an alert'
);

select is(
  (select payload->'userIds' from public.notification_outbox
    where event_name = 'alert/missed_clock_in'),
  jsonb_build_array('aa111111-1111-1111-1111-111111111111'::text),
  'the alert goes to the owner, not to the person who has not clocked in'
);

select is(
  (select count(*)::int from public.notification_outbox
    where event_name = 'alert/document_expiry'
      and payload->>'title' like 'DBS check expires soon%'),
  1,
  'a document expiring inside 30 days enqueues one alert'
);

select is(
  (select count(*)::int from public.notification_outbox
    where event_name = 'alert/document_expiry'
      and payload->>'title' like 'Manual handling%'),
  0,
  'one that lapsed two months ago does not — that is history, not news'
);

select ok(
  not has_function_privilege(
    'authenticated', 'public.enqueue_scheduled_alerts()', 'EXECUTE'),
  'a signed-in user cannot run the job, and so cannot make it notify anybody'
);

select * from finish();
rollback;
