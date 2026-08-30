-- =====================================================================
-- rota_amendment_diff.test.sql — GAP-007: an amended rota says what
-- changed, and only to the people it changed for.
--
-- Before 0083 a staff member got "13 Oct - 19 Oct updated", sent to
-- everyone holding a shift in the new rota. The diff has always been
-- derivable — 0061 archives the superseded rota rather than overwriting
-- it — and nothing derived it.
--
-- The subtle part is that `begin_rota_revision` COPIES shifts without
-- their ids, so there is no identity to match on and the comparison is
-- by value. That makes two things easy to get wrong, and both are
-- asserted here:
--
--   * an UNCHANGED shift must cancel out, or every amendment pages the
--     whole roster — which is the noise this replaces; and
--   * a person working two IDENTICAL shifts in one day must keep both.
--     `EXCEPT` would collapse them and report a phantom removal;
--     `EXCEPT ALL` is what makes that right.
--
-- What has to hold:
--
--   1. a changed shift is reported, as before-and-after;
--   2. an unchanged shift is not reported at all;
--   3. a removed shift is reported as removed;
--   4. an added shift is reported as added;
--   5. duplicate identical shifts on both sides cancel out;
--   6. only the affected person is named;
--   7. a first publish produces no diff — there is nothing to compare;
--   8. an amendment that changes nobody's hours enqueues NOTHING.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated','authenticated',
       u.email,'x',now(),now(),now(),'{"provider":"email"}'::jsonb,'{}'::jsonb
from (values
  ('fa111111-1111-1111-1111-111111111111'::uuid,'owner-diff@example.test'),
  ('fa222222-2222-2222-2222-222222222222'::uuid,'ada-diff@example.test'),
  ('fa333333-3333-3333-3333-333333333333'::uuid,'bo-diff@example.test')
) as u(id,email);

insert into public.organisations (id,name,slug,created_by,plan) values
  ('fadddddd-0000-0000-0000-000000000001','Org Diff','org-diff',
   'fa111111-1111-1111-1111-111111111111','enterprise');

insert into public.locations (id,org_id,name,timezone) values
  ('fadddddd-1000-0000-0000-000000000001','fadddddd-0000-0000-0000-000000000001','Ward A','Europe/London');

insert into public.staff_profiles (id,org_id,user_id,first_name,last_name) values
  ('fadddddd-2000-0000-0000-000000000001','fadddddd-0000-0000-0000-000000000001',
   'fa222222-2222-2222-2222-222222222222','Ada','Diff'),
  ('fadddddd-2000-0000-0000-000000000002','fadddddd-0000-0000-0000-000000000001',
   'fa333333-3333-3333-3333-333333333333','Bo','Diff');

-- The published week, and the amendment that supersedes it.
insert into public.rotas (id,org_id,location_id,name,period_start,period_end,status) values
  ('fadddddd-3000-0000-0000-000000000001','fadddddd-0000-0000-0000-000000000001',
   'fadddddd-1000-0000-0000-000000000001','Week','2099-03-02','2099-03-08','published');

insert into public.rotas (id,org_id,location_id,name,period_start,period_end,status,supersedes_rota_id) values
  ('fadddddd-3000-0000-0000-000000000002','fadddddd-0000-0000-0000-000000000001',
   'fadddddd-1000-0000-0000-000000000001','Week','2099-03-02','2099-03-08','draft',
   'fadddddd-3000-0000-0000-000000000001');

-- BEFORE: Ada Mon 09-17 (unchanged), Ada Tue 09-17 (moves), Bo Wed 09-17
-- (removed), Ada Fri 08-12 twice (identical duplicates).
insert into public.shifts (org_id,rota_id,location_id,staff_profile_id,status,starts_at,ends_at) values
  ('fadddddd-0000-0000-0000-000000000001','fadddddd-3000-0000-0000-000000000001','fadddddd-1000-0000-0000-000000000001','fadddddd-2000-0000-0000-000000000001','assigned', timestamptz '2099-03-02 09:00+00', timestamptz '2099-03-02 17:00+00'),
  ('fadddddd-0000-0000-0000-000000000001','fadddddd-3000-0000-0000-000000000001','fadddddd-1000-0000-0000-000000000001','fadddddd-2000-0000-0000-000000000001','assigned', timestamptz '2099-03-03 09:00+00', timestamptz '2099-03-03 17:00+00'),
  ('fadddddd-0000-0000-0000-000000000001','fadddddd-3000-0000-0000-000000000001','fadddddd-1000-0000-0000-000000000001','fadddddd-2000-0000-0000-000000000002','assigned', timestamptz '2099-03-04 09:00+00', timestamptz '2099-03-04 17:00+00'),
  ('fadddddd-0000-0000-0000-000000000001','fadddddd-3000-0000-0000-000000000001','fadddddd-1000-0000-0000-000000000001','fadddddd-2000-0000-0000-000000000001','assigned', timestamptz '2099-03-06 08:00+00', timestamptz '2099-03-06 12:00+00'),
  ('fadddddd-0000-0000-0000-000000000001','fadddddd-3000-0000-0000-000000000001','fadddddd-1000-0000-0000-000000000001','fadddddd-2000-0000-0000-000000000001','assigned', timestamptz '2099-03-06 08:00+00', timestamptz '2099-03-06 12:00+00');

-- AFTER: Mon identical, Tue moved to 14-22, Bo's Wed gone, Fri duplicates
-- identical, and a brand-new Thu for Ada.
insert into public.shifts (org_id,rota_id,location_id,staff_profile_id,status,starts_at,ends_at) values
  ('fadddddd-0000-0000-0000-000000000001','fadddddd-3000-0000-0000-000000000002','fadddddd-1000-0000-0000-000000000001','fadddddd-2000-0000-0000-000000000001','assigned', timestamptz '2099-03-02 09:00+00', timestamptz '2099-03-02 17:00+00'),
  ('fadddddd-0000-0000-0000-000000000001','fadddddd-3000-0000-0000-000000000002','fadddddd-1000-0000-0000-000000000001','fadddddd-2000-0000-0000-000000000001','assigned', timestamptz '2099-03-03 14:00+00', timestamptz '2099-03-03 22:00+00'),
  ('fadddddd-0000-0000-0000-000000000001','fadddddd-3000-0000-0000-000000000002','fadddddd-1000-0000-0000-000000000001','fadddddd-2000-0000-0000-000000000001','assigned', timestamptz '2099-03-05 20:00+00', timestamptz '2099-03-06 04:00+00'),
  ('fadddddd-0000-0000-0000-000000000001','fadddddd-3000-0000-0000-000000000002','fadddddd-1000-0000-0000-000000000001','fadddddd-2000-0000-0000-000000000001','assigned', timestamptz '2099-03-06 08:00+00', timestamptz '2099-03-06 12:00+00'),
  ('fadddddd-0000-0000-0000-000000000001','fadddddd-3000-0000-0000-000000000002','fadddddd-1000-0000-0000-000000000001','fadddddd-2000-0000-0000-000000000001','assigned', timestamptz '2099-03-06 08:00+00', timestamptz '2099-03-06 12:00+00');

-- 1: the moved shift, reported as before-and-after.
select is(
  (select removed || ' -> ' || added from public.rota_amendment_changes('fadddddd-3000-0000-0000-000000000002')
    where change_date = '2099-03-03'),
  '09:00-17:00 at Ward A -> 14:00-22:00 at Ward A',
  'a changed shift is reported as what it was and what it now is'
);

-- 2: the unchanged Monday.
select is(
  (select count(*)::int from public.rota_amendment_changes('fadddddd-3000-0000-0000-000000000002')
    where change_date = '2099-03-02'),
  0,
  'an unchanged shift is not reported — otherwise every amendment pages the whole roster'
);

-- 5: identical duplicates on both sides.
select is(
  (select count(*)::int from public.rota_amendment_changes('fadddddd-3000-0000-0000-000000000002')
    where change_date = '2099-03-06'),
  0,
  'two identical shifts in one day cancel out on both sides — EXCEPT ALL, not EXCEPT'
);

-- 3: Bo's removal.
select is(
  (select removed from public.rota_amendment_changes('fadddddd-3000-0000-0000-000000000002')
    where change_date = '2099-03-04'),
  '09:00-17:00 at Ward A',
  'a removed shift is reported as removed'
);

-- 4: the new overnight, counted on the day it starts.
select is(
  (select added from public.rota_amendment_changes('fadddddd-3000-0000-0000-000000000002')
    where change_date = '2099-03-05'),
  '20:00-04:00 at Ward A',
  'an added shift is reported, on the day it starts'
);

-- 6: only the people actually affected.
select is(
  (select count(distinct staff_profile_id)::int
     from public.rota_amendment_changes('fadddddd-3000-0000-0000-000000000002')),
  2,
  'only the two people whose shifts changed appear at all'
);

-- 7: a first publish has nothing to diff.
select is(
  (select count(*)::int from public.rota_amendment_changes('fadddddd-3000-0000-0000-000000000001')),
  0,
  'a rota that supersedes nothing produces no diff rather than an error'
);

-- 8: an amendment that changes nobody's hours sends nothing at all.
insert into public.rotas (id,org_id,location_id,name,period_start,period_end,status,supersedes_rota_id) values
  ('fadddddd-3000-0000-0000-000000000003','fadddddd-0000-0000-0000-000000000001',
   null,'Quiet week','2099-04-06','2099-04-07','published'),
  ('fadddddd-3000-0000-0000-000000000004','fadddddd-0000-0000-0000-000000000001',
   null,'Quiet week','2099-04-06','2099-04-07','draft','fadddddd-3000-0000-0000-000000000003');

-- Published through the real function, not a raw UPDATE: 0061's
-- `rotas_guard_status_change` refuses a bare status PATCH, which is the point
-- of that guard. The owner's JWT is what `has_org_role` needs.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub','fa111111-1111-1111-1111-111111111111','role','authenticated')::text,
  true);

select public.publish_rota('fadddddd-3000-0000-0000-000000000004');

reset role;
select set_config('request.jwt.claims','',true);

select is(
  (select count(*)::int from public.notification_outbox
    where payload->>'title' like 'Quiet%' or payload->>'title' like '06 Apr%'),
  0,
  'an amendment nobody works differently under enqueues nothing — the noise this replaces'
);

select * from finish();
rollback;
