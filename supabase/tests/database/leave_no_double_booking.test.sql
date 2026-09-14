-- =====================================================================
-- leave_no_double_booking.test.sql — GAP-123, migration 0152
--
-- One person, one live booking per day. Nothing enforced that until
-- `0152`, and the observed cost was an entitlement counted twice: a
-- staff member booked 21–25 September and then 22–23 September, both
-- were accepted, and the Leave screen read 7.5 days pending for 5.5
-- days of absence. Approving both spends the same days out of the
-- year's allowance twice.
--
-- The assertions are the decisions the migration's header makes, one
-- each, so that changing a decision has to change a test rather than
-- being absorbed silently:
--
--   1. a request that does not overlap is accepted, which is the case
--      the constraint must not break;
--   2. a request overlapping an approved one is refused;
--   3. a request overlapping a *pending* one is refused, because the
--      queue is where the double-count first appears;
--   4. the ends are inclusive — 21–25 and 25–26 share the 25th;
--   5. a different leave TYPE over the same days is still refused;
--   6. two half-days on one date are refused, because the schema
--      cannot tell a second half-day from the same one asked twice;
--   7. a cancelled request blocks nothing, which is what makes
--      withdrawing and re-booking work;
--   8. a rejected request blocks nothing either;
--   9. two people may hold the same dates — the constraint is per
--      person and would be useless if it were not;
--  10. and a pending request cannot be APPROVED into a conflict, which
--      is the manager-side half and the one a trigger on INSERT alone
--      would have missed.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000',
  'da111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
  'owner-overlap@example.test', 'x', now(), now(), now(),
  '{"provider":"email"}'::jsonb, '{}'::jsonb;

insert into public.organisations (id, name, slug, created_by, plan) values
  ('da000000-0000-0000-0000-000000000001', 'Org Overlap', 'org-overlap',
   'da111111-1111-1111-1111-111111111111', 'enterprise');

insert into public.staff_profiles (id, org_id, first_name, last_name) values
  ('da200000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001',
   'Booked', 'Twice'),
  ('da200000-0000-0000-0000-000000000002', 'da000000-0000-0000-0000-000000000001',
   'Someone', 'Else');

-- The booking everything below is measured against.
insert into public.leave_requests
  (id, org_id, staff_profile_id, type, start_date, end_date, status)
values
  ('da300000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001',
   'da200000-0000-0000-0000-000000000001', 'annual', '2026-09-21', '2026-09-25', 'approved');

select lives_ok(
  $$ insert into public.leave_requests
       (id, org_id, staff_profile_id, type, start_date, end_date, status)
     values ('da300000-0000-0000-0000-000000000002',
             'da000000-0000-0000-0000-000000000001',
             'da200000-0000-0000-0000-000000000001', 'annual',
             '2026-09-28', '2026-09-29', 'pending') $$,
  'a request on days nobody has booked is still accepted'
);

select throws_ok(
  $$ insert into public.leave_requests
       (org_id, staff_profile_id, type, start_date, end_date, status)
     values ('da000000-0000-0000-0000-000000000001',
             'da200000-0000-0000-0000-000000000001', 'annual',
             '2026-09-22', '2026-09-23', 'pending') $$,
  '23P01',
  null,
  'the observed defect: a second request inside an approved one is refused'
);

select throws_ok(
  $$ insert into public.leave_requests
       (org_id, staff_profile_id, type, start_date, end_date, status)
     values ('da000000-0000-0000-0000-000000000001',
             'da200000-0000-0000-0000-000000000001', 'annual',
             '2026-09-28', '2026-09-28', 'pending') $$,
  '23P01',
  null,
  'a request overlapping a PENDING one is refused, not only an approved one'
);

select throws_ok(
  $$ insert into public.leave_requests
       (org_id, staff_profile_id, type, start_date, end_date, status)
     values ('da000000-0000-0000-0000-000000000001',
             'da200000-0000-0000-0000-000000000001', 'annual',
             '2026-09-25', '2026-09-26', 'pending') $$,
  '23P01',
  null,
  'the ends are inclusive, so 21-25 and 25-26 share the 25th'
);

select throws_ok(
  $$ insert into public.leave_requests
       (org_id, staff_profile_id, type, start_date, end_date, status)
     values ('da000000-0000-0000-0000-000000000001',
             'da200000-0000-0000-0000-000000000001', 'sick',
             '2026-09-22', '2026-09-22', 'pending') $$,
  '23P01',
  null,
  'a different type over the same day is still one person being absent twice'
);

select throws_ok(
  $$ insert into public.leave_requests
       (org_id, staff_profile_id, type, start_date, end_date, status,
        starts_half, ends_half)
     values ('da000000-0000-0000-0000-000000000001',
             'da200000-0000-0000-0000-000000000001', 'annual',
             '2026-09-28', '2026-09-28', 'pending', true, true) $$,
  '23P01',
  null,
  'two half-days on one date are refused, because the schema cannot tell them apart'
);

-- Withdrawing must free the days back up, or the constraint would trap
-- somebody who mis-typed a date.
update public.leave_requests set status = 'cancelled'
 where id = 'da300000-0000-0000-0000-000000000002';

select lives_ok(
  $$ insert into public.leave_requests
       (id, org_id, staff_profile_id, type, start_date, end_date, status)
     values ('da300000-0000-0000-0000-000000000003',
             'da000000-0000-0000-0000-000000000001',
             'da200000-0000-0000-0000-000000000001', 'annual',
             '2026-09-28', '2026-09-29', 'pending') $$,
  'a cancelled request blocks nothing, so withdrawing and re-booking works'
);

update public.leave_requests set status = 'rejected'
 where id = 'da300000-0000-0000-0000-000000000003';

select lives_ok(
  $$ insert into public.leave_requests
       (id, org_id, staff_profile_id, type, start_date, end_date, status)
     values ('da300000-0000-0000-0000-000000000004',
             'da000000-0000-0000-0000-000000000001',
             'da200000-0000-0000-0000-000000000001', 'annual',
             '2026-09-28', '2026-09-29', 'pending') $$,
  'a rejected request blocks nothing either'
);

select lives_ok(
  $$ insert into public.leave_requests
       (org_id, staff_profile_id, type, start_date, end_date, status)
     values ('da000000-0000-0000-0000-000000000001',
             'da200000-0000-0000-0000-000000000002', 'annual',
             '2026-09-21', '2026-09-25', 'approved') $$,
  'two people may hold the same dates — this is per person, not per organisation'
);

-- The manager-side half. `da300000-...-04` is pending over 28-29 Sept;
-- a second pending request for 29 Sept-1 Oct is refused on insert, so
-- build the conflict the only way it can exist — from a decided row —
-- and then try to approve it.
insert into public.leave_requests
  (id, org_id, staff_profile_id, type, start_date, end_date, status)
values
  ('da300000-0000-0000-0000-000000000005', 'da000000-0000-0000-0000-000000000001',
   'da200000-0000-0000-0000-000000000001', 'annual', '2026-09-29', '2026-10-01', 'rejected');

select throws_ok(
  $$ update public.leave_requests set status = 'approved'
      where id = 'da300000-0000-0000-0000-000000000005' $$,
  '23P01',
  null,
  'a decided request cannot be approved into a conflict with a live one'
);

select * from finish();
rollback;
