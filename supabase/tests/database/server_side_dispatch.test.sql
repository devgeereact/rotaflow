-- =====================================================================
-- server_side_dispatch.test.sql — GAP-026: the database, not the
-- browser, is what owes a notification.
--
-- 0087 moves the last four dispatches out of `LeavePage`, `SwapsPage`
-- and `AnnouncementsPage`. The property under test is the one that made
-- the old shape lossy: the outbox row must exist because the state
-- changed, not because a client got round to posting it.
--
-- What is asserted, and why each one is a way this could be wrong:
--
--   1. approving leave enqueues, addressed to the requester;
--   2. it says "declined", not "rejected", on the other branch — the
--      stored status and the sentence a person reads are not the same
--      thing, and the two pages disagreed about it before;
--   3. a manager deciding their OWN request enqueues nothing, or the
--      product notifies you about something you just did;
--   4. a status change that is not a decision (pending -> cancelled)
--      enqueues nothing;
--   5. approving a swap enqueues, addressed to the requester and not to
--      the person taking the shift;
--   6. publishing an announcement enqueues once, to the whole org;
--   7. a department-scoped announcement reaches that department only —
--      the audience rule used to live in the browser, so this is the
--      assertion that it survived the move intact;
--   8. editing an already-published announcement enqueues NOTHING, or
--      fixing a typo pages a department twice;
--   9. an inactive staff member is not in the audience;
--  10. `remind_announcement_unread` counts and enqueues only those who
--      have not read it;
--  11. it returns 0 and enqueues nothing when everyone has;
--  12. a member with no management role cannot call it — it is
--      SECURITY DEFINER, so its own check is the only thing between a
--      staff member and a broadcast to every phone in the org;
--  13. `announcement_audience` is not callable by a client at all. It is
--      SECURITY DEFINER with no membership check of its own — correct,
--      because both real callers have already established who is asking
--      — so a direct grant would answer "who is this announcement for"
--      for any organisation's announcement (0088).
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(13);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('d1111111-1111-1111-1111-111111111111'::uuid, 'owner-dispatch@example.test'),
  ('d2222222-2222-2222-2222-222222222222'::uuid, 'staff-dispatch@example.test'),
  ('d3333333-3333-3333-3333-333333333333'::uuid, 'other-dispatch@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('dddddddd-0000-0000-0000-000000000001', 'Org Dispatch', 'org-dispatch',
   'd1111111-1111-1111-1111-111111111111', 'enterprise');

-- `created_by` bootstraps the owner membership (0002). The other two are
-- added explicitly.
insert into public.memberships (org_id, user_id, role) values
  ('dddddddd-0000-0000-0000-000000000001', 'd2222222-2222-2222-2222-222222222222', 'staff'),
  ('dddddddd-0000-0000-0000-000000000001', 'd3333333-3333-3333-3333-333333333333', 'staff')
on conflict do nothing;

insert into public.locations (id, org_id, name, timezone) values
  ('dddddddd-1000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001', 'Ward A', 'Europe/London'),
  ('dddddddd-1000-0000-0000-000000000002',
   'dddddddd-0000-0000-0000-000000000001', 'Ward B', 'Europe/London');

insert into public.departments (id, org_id, location_id, name) values
  ('dddddddd-1100-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   'dddddddd-1000-0000-0000-000000000001', 'Nights'),
  ('dddddddd-1100-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001',
   'dddddddd-1000-0000-0000-000000000002', 'Days');

-- The owner also holds a staff profile: assertion 3 needs a request whose
-- requester and reviewer are the same person.
--
-- It is not inserted, because it already exists: since `0121` creating an
-- organisation creates a staff record for its founder, and
-- `staff_profiles_org_user_idx` is unique on (org_id, user_id). Its id is
-- generated, so remember it rather than asserting one — a trigger refuses to
-- let this row be rewritten, which is itself the control working.
select set_config(
  'test.owner_staff',
  (select id::text from public.staff_profiles
    where org_id = 'dddddddd-0000-0000-0000-000000000001'
      and user_id = 'd1111111-1111-1111-1111-111111111111'),
  true);

insert into public.staff_profiles (id, org_id, user_id, first_name, last_name, department_id, active) values
  ('dddddddd-2000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001',
   'd2222222-2222-2222-2222-222222222222', 'Sam', 'Staff',
   'dddddddd-1100-0000-0000-000000000001', true),
  ('dddddddd-2000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000001',
   'd3333333-3333-3333-3333-333333333333', 'Ola', 'Other',
   'dddddddd-1100-0000-0000-000000000002', true);

-- ── leave ─────────────────────────────────────────────────────────────
insert into public.leave_requests (id, org_id, staff_profile_id, start_date, end_date, status) values
  ('dddddddd-3000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   'dddddddd-2000-0000-0000-000000000002', date '2027-03-03', date '2027-03-07', 'pending'),
  ('dddddddd-3000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001',
   'dddddddd-2000-0000-0000-000000000002', date '2027-04-01', date '2027-04-01', 'pending'),
  ('dddddddd-3000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000001',
   current_setting('test.owner_staff')::uuid, date '2027-05-01', date '2027-05-02', 'pending'),
  ('dddddddd-3000-0000-0000-000000000004', 'dddddddd-0000-0000-0000-000000000001',
   'dddddddd-2000-0000-0000-000000000002', date '2027-06-01', date '2027-06-02', 'pending');

update public.leave_requests
   set status = 'approved', reviewed_by = 'd1111111-1111-1111-1111-111111111111'
 where id = 'dddddddd-3000-0000-0000-000000000001';

select is(
  (select payload->'userIds'->>0
     from public.notification_outbox
    where event_name = 'leave/reviewed'
      and payload->>'title' = 'Your leave request was approved'),
  'd2222222-2222-2222-2222-222222222222',
  'approving leave enqueues one notification, addressed to the requester');

update public.leave_requests
   set status = 'rejected', reviewed_by = 'd1111111-1111-1111-1111-111111111111'
 where id = 'dddddddd-3000-0000-0000-000000000002';

select is(
  (select payload->>'title'
     from public.notification_outbox
    where event_name = 'leave/reviewed'
      and payload->>'body' = '1 April 2027'),
  'Your leave request was declined',
  'a rejected request tells the person it was DECLINED, and dates it as the app does');

-- The owner deciding their own request.
update public.leave_requests
   set status = 'approved', reviewed_by = 'd1111111-1111-1111-1111-111111111111'
 where id = 'dddddddd-3000-0000-0000-000000000003';

select is(
  (select count(*)::int
     from public.notification_outbox
    where event_name = 'leave/reviewed'
      and payload->'userIds'->>0 = 'd1111111-1111-1111-1111-111111111111'),
  0,
  'deciding your own request notifies nobody');

update public.leave_requests
   set status = 'cancelled'
 where id = 'dddddddd-3000-0000-0000-000000000004';

select is(
  (select count(*)::int from public.notification_outbox where event_name = 'leave/reviewed'),
  2,
  'a withdrawal is not a decision and enqueues nothing');

-- ── swaps ─────────────────────────────────────────────────────────────
-- No rota: `shift_swaps.shift_id` is NOT NULL but `shifts.rota_id` is not, and
-- the swap trigger reads neither. A published rota here would only couple this
-- test to 0061's publish guards for nothing.
insert into public.shifts (id, org_id, location_id, staff_profile_id, starts_at, ends_at, status) values
  ('dddddddd-4100-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   'dddddddd-1000-0000-0000-000000000001', 'dddddddd-2000-0000-0000-000000000002',
   timestamptz '2027-03-02 09:00+00', timestamptz '2027-03-02 17:00+00', 'assigned');

insert into public.shift_swaps (id, org_id, shift_id, requested_by, target_staff_profile_id, status) values
  ('dddddddd-4200-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   'dddddddd-4100-0000-0000-000000000001', 'dddddddd-2000-0000-0000-000000000002',
   'dddddddd-2000-0000-0000-000000000003', 'accepted');

update public.shift_swaps
   set status = 'approved', reviewed_by = 'd1111111-1111-1111-1111-111111111111'
 where id = 'dddddddd-4200-0000-0000-000000000001';

select is(
  (select payload->'userIds'
     from public.notification_outbox
    where event_name = 'swap/reviewed'),
  jsonb_build_array('d2222222-2222-2222-2222-222222222222'::text),
  'an approved swap tells the person who asked for it, and only them');

-- ── announcements ─────────────────────────────────────────────────────
insert into public.announcements (id, org_id, author_user_id, scope, title, body, published_at) values
  ('dddddddd-5000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   'd1111111-1111-1111-1111-111111111111', 'org', 'Fire drill', 'Tuesday 10am', now());

select is(
  (select jsonb_array_length(payload->'userIds')
     from public.notification_outbox
    where event_name = 'announcement/published'
      and payload->>'title' = 'Fire drill'),
  3,
  'an org-wide announcement is enqueued once, to every linked staff member');

insert into public.announcements (id, org_id, author_user_id, scope, department_id, title, body, published_at) values
  ('dddddddd-5000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001',
   'd1111111-1111-1111-1111-111111111111', 'department',
   'dddddddd-1100-0000-0000-000000000002', 'Days only', 'Kit arriving', now());

select is(
  (select payload->'userIds'
     from public.notification_outbox
    where event_name = 'announcement/published'
      and payload->>'title' = 'Days only'),
  jsonb_build_array('d3333333-3333-3333-3333-333333333333'::text),
  'a department-scoped announcement reaches that department only');

update public.announcements
   set title = 'Fire drill (corrected)', published_at = now()
 where id = 'dddddddd-5000-0000-0000-000000000001';

select is(
  (select count(*)::int
     from public.notification_outbox
    where event_name = 'announcement/published'),
  2,
  'editing an already-published announcement notifies nobody a second time');

-- As the owner, because `staff_profiles_restrict_self_edit` (0042/0055) lets
-- only an owner or manager change anything but a phone number and photo — and
-- unlike 0061's rota guards it has no `auth.uid() is null` bypass, so the
-- fixture cannot make somebody a leaver anonymously.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

update public.staff_profiles set active = false
 where id = 'dddddddd-2000-0000-0000-000000000003';

select is(
  (select count(*)::int from public.announcement_audience('dddddddd-5000-0000-0000-000000000002')),
  0,
  'a former staff member is not in the audience');

update public.staff_profiles set active = true
 where id = 'dddddddd-2000-0000-0000-000000000003';

select set_config('request.jwt.claims', '', true);

-- ── reminders ─────────────────────────────────────────────────────────
insert into public.announcement_reads (org_id, announcement_id, staff_profile_id) values
  ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-5000-0000-0000-000000000001',
   'dddddddd-2000-0000-0000-000000000002');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

select is(
  public.remind_announcement_unread('dddddddd-5000-0000-0000-000000000001'),
  2,
  'a reminder reaches the two who have not read it, not the one who has');

-- Back to the table owner to write the remaining receipts:
-- `announcement_reads_insert` (0046) only lets a member record their OWN,
-- which is correct and makes the fixture unwritable as `authenticated`.
reset role;
insert into public.announcement_reads (org_id, announcement_id, staff_profile_id) values
  ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-5000-0000-0000-000000000001',
   current_setting('test.owner_staff')::uuid),
  ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-5000-0000-0000-000000000001',
   'dddddddd-2000-0000-0000-000000000003');
set local role authenticated;

select is(
  public.remind_announcement_unread('dddddddd-5000-0000-0000-000000000001'),
  0,
  'once everyone has read it, the reminder reaches nobody and enqueues nothing');

-- A staff member, who may read the announcement but may not re-broadcast it.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd2222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true);

select throws_ok(
  $$select public.remind_announcement_unread('dddddddd-5000-0000-0000-000000000002')$$,
  '42501',
  'Not permitted',
  'a staff member cannot broadcast a reminder to the whole department');

reset role;

select ok(
  not has_function_privilege('authenticated', 'public.announcement_audience(uuid)', 'EXECUTE'),
  'announcement_audience is internal: no client role may call it directly');

select * from finish();
rollback;
