-- =====================================================================
-- clock_event_reported_time.test.sql — BUG-045: the guard stops lying.
--
-- `clock_events_guard_event_at` (0037) rewrites `event_at` to now() when a
-- non-manager submits a time outside its window, and did it silently. A
-- clock-in replayed from the offline outbox after three days without
-- signal landed stamped with the sync time, and nothing recorded that the
-- device had said otherwise.
--
-- 0068 keeps the guard and adds `event_at_reported`. What has to hold:
--
--   1. the guard still clamps — this is a payroll fraud control and the
--      change must not weaken it;
--   2. what the device claimed is preserved, so a manager can see the
--      override and correct it;
--   3. a normal in-window submission is untouched and leaves the new
--      column null, so "null" keeps meaning "exactly what was submitted";
--   4. a client cannot fabricate a reported time by supplying one;
--   5. owners and managers stay exempt, because amending an event is
--      their job.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id, 'authenticated', 'authenticated', u.email, 'x',
  now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('c1111111-1111-1111-1111-111111111111'::uuid, 'owner-c@example.test'),
  ('c2222222-2222-2222-2222-222222222222'::uuid, 'staff-c@example.test')
) as u(id, email);

insert into public.organisations (id, name, slug, created_by) values
  ('cccccccc-0000-0000-0000-000000000001', 'Org C', 'org-c-clock', 'c1111111-1111-1111-1111-111111111111');

-- on_org_created already made the creator an owner; only the staff member
-- needs adding.
insert into public.memberships (org_id, user_id, role, status) values
  ('cccccccc-0000-0000-0000-000000000001', 'c2222222-2222-2222-2222-222222222222', 'staff', 'active');

insert into public.staff_profiles (id, org_id, user_id, first_name, last_name) values
  ('cccccccc-2222-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
   'c2222222-2222-2222-2222-222222222222', 'Sam', 'Staff');

-- ---------- as the staff member, who the guard applies to --------------
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c2222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);

-- 1 & 2: a genuine offline clock-in, replayed four days late.
insert into public.clock_events (org_id, staff_profile_id, type, method, event_at)
values ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-2222-0000-0000-000000000001',
        'in', 'manual', timezone('utc', now()) - interval '4 days');

select ok(
  (select event_at from public.clock_events where type = 'in')
    > timezone('utc', now()) - interval '5 minutes',
  'the guard still clamps a four-day-old submission — the fraud control is intact'
);
select ok(
  (select event_at_reported from public.clock_events where type = 'in')
    < timezone('utc', now()) - interval '3 days',
  'and what the device actually claimed is preserved, not discarded'
);
select isnt(
  (select event_at_reported from public.clock_events where type = 'in'),
  null,
  'an overridden event is identifiable, so a manager can find and correct it'
);

-- 3: an ordinary, in-window clock-out is left completely alone.
insert into public.clock_events (org_id, staff_profile_id, type, method, event_at)
values ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-2222-0000-0000-000000000001',
        'out', 'manual', timezone('utc', now()) - interval '2 minutes');

select is(
  (select event_at_reported from public.clock_events where type = 'out'),
  null,
  'a normal submission leaves the column null — null means "exactly what was submitted"'
);
select ok(
  (select event_at from public.clock_events where type = 'out')
    < timezone('utc', now()) - interval '1 minute',
  'and its time is untouched'
);

-- 4: a client cannot fabricate a reported time on a row the guard leaves alone.
insert into public.clock_events (org_id, staff_profile_id, type, method, event_at, event_at_reported)
values ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-2222-0000-0000-000000000001',
        'break_start', 'manual', timezone('utc', now()), timezone('utc', now()) - interval '9 days');

select is(
  (select event_at_reported from public.clock_events where type = 'break_start'),
  null,
  'a supplied event_at_reported is overwritten — only the trigger may set it'
);

-- 5: a future timestamp is clamped too, and recorded.
insert into public.clock_events (org_id, staff_profile_id, type, method, event_at)
values ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-2222-0000-0000-000000000001',
        'break_end', 'manual', timezone('utc', now()) + interval '3 hours');

select ok(
  (select event_at from public.clock_events where type = 'break_end')
    <= timezone('utc', now()) + interval '5 minutes',
  'a device with a wrong clock cannot book time in the future'
);
select isnt(
  (select event_at_reported from public.clock_events where type = 'break_end'),
  null,
  'and that override is recorded too, not just the backdated kind'
);

-- ---------- as the owner, who is exempt -------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

insert into public.clock_events (org_id, staff_profile_id, type, method, event_at)
values ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-2222-0000-0000-000000000001',
        'in', 'manual', timezone('utc', now()) - interval '6 days');

select ok(
  (select count(*)::int from public.clock_events
    where event_at < timezone('utc', now()) - interval '5 days') = 1,
  'an owner may still record a six-day-old event — correcting a timesheet is their job'
);

select * from finish();
rollback;
