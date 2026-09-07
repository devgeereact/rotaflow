-- =====================================================================
-- swap_decision_atomicity.test.sql — regression guard for RF-02 and RF-03,
-- fixed by 0123_a_swap_decision_is_one_transaction.sql.
--
-- RF-02: the client approved a swap and reassigned its shift in two
-- separate requests. The audit reproduced the gap by rejecting the second:
-- the swap stayed 'approved', the shift stayed with the original person,
-- and the notification trigger had already told the requester it went
-- through. The screen asked the manager to move the shift by hand.
--
-- RF-03: an approved swap was a reusable command. `apply_swap_reassignment`
-- took no row lock, kept no record that it had run, and updated the shift
-- by id with no predicate on who currently held it — so replaying an old
-- A-to-B approval silently reverted a later legitimate B-to-C transfer. It
-- also did not refuse an archived rota, which 0061 otherwise treats as
-- history that is never edited again.
--
-- Written against the database rather than the service on purpose: the
-- point of the fix is that these rules hold for a direct PostgREST call
-- from curl with a valid manager JWT, which `set local role authenticated`
-- plus a jwt.claims GUC reproduces here.
--
-- Swaps are addressed by `note`, never by "the newest". Every row in this
-- file is inserted inside one transaction, so `created_at` is the same
-- instant on all of them and `order by created_at desc limit 1` picks
-- between them arbitrarily — which is how the first draft of this file
-- asserted against the wrong swap twice and read as a failure of the
-- migration rather than of the fixture.
-- =====================================================================

begin;
select plan(16);

-- ---------- fixtures --------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '44444444-4444-4444-4444-444444444444',
  'authenticated', 'authenticated', 'swap-manager@example.com',
  crypt('not-a-real-password', gen_salt('bf')),
  now(), now(), now(), '{}', '{}'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text,
  true
);

insert into public.organisations (name, slug, created_by)
values ('Swap Test Org', 'swap-test-org', '44444444-4444-4444-4444-444444444444');

insert into public.locations (org_id, name)
values ((select id from public.organisations where slug = 'swap-test-org'), 'Depot');

-- Three people: the shift's owner, the colleague taking it, and a third who
-- will later hold the shift so a replay has something to try to revert.
insert into public.staff_profiles (org_id, first_name, last_name)
select (select id from public.organisations where slug = 'swap-test-org'), n, 'Tester'
  from (values ('Ana'), ('Ben'), ('Cass')) as v(n);

insert into public.rotas (org_id, location_id, name, period_start, period_end)
values (
  (select id from public.organisations where slug = 'swap-test-org'),
  (select id from public.locations where name = 'Depot'),
  'Swap Week', '2026-09-07', '2026-09-13');

insert into public.shifts (org_id, rota_id, location_id, staff_profile_id, starts_at, ends_at, status)
select (select id from public.organisations where slug = 'swap-test-org'),
       (select id from public.rotas where name = 'Swap Week'),
       (select id from public.locations where name = 'Depot'),
       (select id from public.staff_profiles where first_name = 'Ana'),
       '2026-09-08T09:00:00Z', '2026-09-08T17:00:00Z', 'assigned';

insert into public.shift_swaps (org_id, shift_id, requested_by, target_staff_profile_id, status, note)
select (select id from public.organisations where slug = 'swap-test-org'),
       (select id from public.shifts where starts_at = '2026-09-08T09:00:00Z'),
       (select id from public.staff_profiles where first_name = 'Ana'),
       (select id from public.staff_profiles where first_name = 'Ben'),
       'accepted', 'first';

-- ---------- 1. the happy path commits both halves ---------------------
select is(
  (select public.decide_shift_swap(
     (select id from public.shift_swaps where note = 'first'), 'approved') ->> 'outcome'),
  'approved',
  'a manager decides a swap through one call'
);

select is(
  (select staff_profile_id from public.shifts where starts_at = '2026-09-08T09:00:00Z'),
  (select id from public.staff_profiles where first_name = 'Ben'),
  'the shift moved in the same call that approved the swap'
);

select is(
  (select status from public.shift_swaps where note = 'first'),
  'approved',
  'and the swap records the decision'
);

select isnt(
  (select applied_at from public.shift_swaps where note = 'first'),
  null,
  'the swap is marked spent, so it is no longer a standing reassignment command'
);

select is(
  (select applied_from_staff_profile_id from public.shift_swaps where note = 'first'),
  (select id from public.staff_profiles where first_name = 'Ana'),
  'and records who actually held the shift when it moved'
);

select is(
  (select count(*)::int from public.notification_outbox where event_name = 'swap/reviewed'),
  0,
  'no notification for a decision the requester made themselves'
);

-- ---------- 2. RF-03: a spent swap is not replayable -------------------
-- Ben legitimately hands the shift on to Cass. Replaying the original
-- Ana-to-Ben approval must not take it back off Cass.
select set_config('rotaflow.shift_transition', 'on', true);
update public.shifts
   set staff_profile_id = (select id from public.staff_profiles where first_name = 'Cass')
 where starts_at = '2026-09-08T09:00:00Z';
select set_config('rotaflow.shift_transition', '', true);

select throws_ok(
  format($$ select public.apply_swap_reassignment(%L) $$,
         (select id from public.shift_swaps where note = 'first')),
  'SWAP9', null,
  'replaying a spent swap is refused'
);

select is(
  (select staff_profile_id from public.shifts where starts_at = '2026-09-08T09:00:00Z'),
  (select id from public.staff_profiles where first_name = 'Cass'),
  'and the later legitimate transfer survives the replay attempt'
);

select is(
  (select public.decide_shift_swap(
     (select id from public.shift_swaps where note = 'first'), 'approved') ->> 'outcome'),
  'already-decided',
  'deciding a settled swap reports the recorded outcome rather than deciding again'
);

-- ---------- 3. RF-02/03: the requester must still hold the shift -------
insert into public.shift_swaps (org_id, shift_id, requested_by, target_staff_profile_id, status, note)
select (select id from public.organisations where slug = 'swap-test-org'),
       (select id from public.shifts where starts_at = '2026-09-08T09:00:00Z'),
       (select id from public.staff_profiles where first_name = 'Ana'),
       (select id from public.staff_profiles where first_name = 'Ben'),
       'accepted', 'second';

select throws_ok(
  format($$ select public.decide_shift_swap(%L, 'approved') $$,
         (select id from public.shift_swaps where note = 'second')),
  'SWAP6', null,
  'a swap whose shift has moved on since it was raised is refused'
);

-- RF-02's core claim. The refusal took the approval with it: a raise rolls
-- the whole function back, so there is no approved swap whose shift never
-- moved, and no notification announcing one.
select is(
  (select status from public.shift_swaps where note = 'second'),
  'accepted',
  'and the refusal rolled the approval back with it — no half-decided swap'
);

select is(
  (select staff_profile_id from public.shifts where starts_at = '2026-09-08T09:00:00Z'),
  (select id from public.staff_profiles where first_name = 'Cass'),
  'and nobody was moved'
);

-- ---------- 4. an inactive recipient is refused ------------------------
select set_config('rotaflow.shift_transition', 'on', true);
update public.shifts
   set staff_profile_id = (select id from public.staff_profiles where first_name = 'Ana')
 where starts_at = '2026-09-08T09:00:00Z';
select set_config('rotaflow.shift_transition', '', true);

update public.staff_profiles set active = false where first_name = 'Ben';

select throws_ok(
  format($$ select public.decide_shift_swap(%L, 'approved') $$,
         (select id from public.shift_swaps where note = 'second')),
  'SWAP8', null,
  'a shift is not handed to somebody who has left the organisation'
);

update public.staff_profiles set active = true where first_name = 'Ben';

-- ---------- 5. an archived rota is history ----------------------------
-- `rotas_guard_status_change` (0061) refuses a raw status write, which is
-- exactly what that trigger is for. Its documented exemption is the
-- transaction-local flag the publish/revise functions set, so archiving here
-- goes through that rather than around the trigger.
select set_config('rotaflow.rota_transition', 'on', true);
update public.rotas set status = 'published', published_at = now() where name = 'Swap Week';
update public.rotas set status = 'archived', archived_at = now() where name = 'Swap Week';
select set_config('rotaflow.rota_transition', '', true);

select throws_ok(
  format($$ select public.decide_shift_swap(%L, 'approved') $$,
         (select id from public.shift_swaps where note = 'second')),
  'SWAP5', null,
  'a shift on an archived rota is not reassigned'
);

-- ---------- 6. rejection needs no shift movement -----------------------
select is(
  (select public.decide_shift_swap(
     (select id from public.shift_swaps where note = 'second'), 'rejected') ->> 'outcome'),
  'declined',
  'a rejection is recorded without touching the shift'
);

select is(
  (select staff_profile_id from public.shifts where starts_at = '2026-09-08T09:00:00Z'),
  (select id from public.staff_profiles where first_name = 'Ana'),
  'and the shift stays exactly where it was'
);

select * from finish();
rollback;
