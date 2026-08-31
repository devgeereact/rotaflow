-- =====================================================================
-- open_shift_claims.test.sql — CAP-010
--
-- `shifts.status` has accepted `'open'` since `0002` and nothing has
-- ever shown one to the person who could cover it.
--
--   1. the board lists a published open shift;
--   2. and NOT one on a draft rota — a shift on somebody's phone before
--      the rota is published tells them they are working a shift nobody
--      has committed to;
--   3. and not one already taken;
--   4. a shift overlapping the reader's own roster is listed, but
--      flagged. Filtering it out would leave somebody staring at "no
--      open shifts" while a colleague sees four, with no way to tell why;
--   5. claiming assigns it to the caller;
--   6. and changes its status, so it stops appearing on the board;
--   7. a SECOND claim on the same shift is refused with 40001. This is
--      the assertion the design hangs on: two people on a ward tap the
--      same shift within a second of each other, and a check-then-update
--      would let both through;
--   8. a clashing shift is refused even though it is on the board;
--   9. a draft rota's shift cannot be claimed by id, so the board's
--      filter is not the only thing keeping it out;
--  10. somebody in another organisation gets "no longer exists" rather
--      than a permission error — the answer must not confirm the id;
--  11. `anon` cannot call the claim function at all.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(11);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('b1111111-1111-1111-1111-111111111111'::uuid, 'owner-open@example.test'),
  ('b2222222-2222-2222-2222-222222222222'::uuid, 'staff-open@example.test'),
  ('b3333333-3333-3333-3333-333333333333'::uuid, 'rival-open@example.test'),
  ('b4444444-4444-4444-4444-444444444444'::uuid, 'outsider-open@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('b0000000-0000-0000-0000-000000000001', 'Org Open', 'org-open',
   'b1111111-1111-1111-1111-111111111111', 'enterprise'),
  ('b0000000-0000-0000-0000-000000000002', 'Other Org', 'other-open',
   'b4444444-4444-4444-4444-444444444444', 'enterprise');

insert into public.memberships (org_id, user_id, role) values
  ('b0000000-0000-0000-0000-000000000001', 'b2222222-2222-2222-2222-222222222222', 'staff'),
  ('b0000000-0000-0000-0000-000000000001', 'b3333333-3333-3333-3333-333333333333', 'staff')
on conflict do nothing;

insert into public.locations (id, org_id, name, timezone) values
  ('b0100000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   'Ward B', 'Europe/London');

insert into public.staff_profiles (id, org_id, user_id, first_name, last_name) values
  ('b0200000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   'b2222222-2222-2222-2222-222222222222', 'Sam', 'Staff'),
  ('b0200000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001',
   'b3333333-3333-3333-3333-333333333333', 'Rival', 'Staff');

insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status, created_by) values
  ('b0300000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   'b0100000-0000-0000-0000-000000000001', 'Published week',
   current_date, current_date + 6, 'published', 'b1111111-1111-1111-1111-111111111111'),
  ('b0300000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001',
   'b0100000-0000-0000-0000-000000000001', 'Draft week',
   current_date + 7, current_date + 13, 'draft', 'b1111111-1111-1111-1111-111111111111');

insert into public.shifts
  (id, org_id, rota_id, location_id, staff_profile_id, starts_at, ends_at, status)
values
  -- The claimable one.
  ('b0400000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   'b0300000-0000-0000-0000-000000000001', 'b0100000-0000-0000-0000-000000000001', null,
   timezone('utc', now()) + interval '2 days',
   timezone('utc', now()) + interval '2 days 8 hours', 'open'),
  -- Open, but on the draft rota.
  ('b0400000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001',
   'b0300000-0000-0000-0000-000000000002', 'b0100000-0000-0000-0000-000000000001', null,
   timezone('utc', now()) + interval '9 days',
   timezone('utc', now()) + interval '9 days 8 hours', 'open'),
  -- Already taken.
  ('b0400000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001',
   'b0300000-0000-0000-0000-000000000001', 'b0100000-0000-0000-0000-000000000001',
   'b0200000-0000-0000-0000-000000000002',
   timezone('utc', now()) + interval '3 days',
   timezone('utc', now()) + interval '3 days 8 hours', 'assigned'),
  -- Sam already works this one …
  ('b0400000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001',
   'b0300000-0000-0000-0000-000000000001', 'b0100000-0000-0000-0000-000000000001',
   'b0200000-0000-0000-0000-000000000001',
   timezone('utc', now()) + interval '4 days',
   timezone('utc', now()) + interval '4 days 8 hours', 'assigned'),
  -- … so this open one overlaps it.
  ('b0400000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001',
   'b0300000-0000-0000-0000-000000000001', 'b0100000-0000-0000-0000-000000000001', null,
   timezone('utc', now()) + interval '4 days 4 hours',
   timezone('utc', now()) + interval '4 days 12 hours', 'open');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b2222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true);

select is(
  (select count(*)::int from public.open_shifts('b0000000-0000-0000-0000-000000000001')),
  2,
  'the board lists the published open shifts, and only those'
);

select is(
  (select count(*)::int from public.open_shifts('b0000000-0000-0000-0000-000000000001')
    where shift_id = 'b0400000-0000-0000-0000-000000000002'),
  0,
  'a draft rota''s open shift is not offered — nobody has committed to it'
);

select is(
  (select count(*)::int from public.open_shifts('b0000000-0000-0000-0000-000000000001')
    where shift_id = 'b0400000-0000-0000-0000-000000000003'),
  0,
  'and neither is one somebody already has'
);

select ok(
  (select clashes_with_mine from public.open_shifts('b0000000-0000-0000-0000-000000000001')
    where shift_id = 'b0400000-0000-0000-0000-000000000005'),
  'a shift overlapping the reader''s own roster is listed, and flagged'
);

select is(
  public.claim_open_shift('b0400000-0000-0000-0000-000000000001'),
  'b0400000-0000-0000-0000-000000000001'::uuid,
  'claiming succeeds'
);

select is(
  (select staff_profile_id || ':' || status from public.shifts
    where id = 'b0400000-0000-0000-0000-000000000001'),
  'b0200000-0000-0000-0000-000000000001:assigned',
  'and the shift is assigned, so it leaves the board'
);

-- The assertion the design hangs on. A second person, the same shift.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b3333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true);

select throws_ok(
  $$ select public.claim_open_shift('b0400000-0000-0000-0000-000000000001') $$,
  '40001',
  'Somebody else has just taken that shift',
  'the second person to tap is told so, rather than both succeeding'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b2222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true);

select throws_ok(
  $$ select public.claim_open_shift('b0400000-0000-0000-0000-000000000005') $$,
  '42501',
  'You are already working at that time',
  'a clashing shift is refused, even though the board shows it'
);

select throws_ok(
  $$ select public.claim_open_shift('b0400000-0000-0000-0000-000000000002') $$,
  '42501',
  'That shift is on a rota that has not been published',
  'the board''s filter is not the only thing keeping a draft out'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b4444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text,
  true);

select throws_ok(
  $$ select public.claim_open_shift('b0400000-0000-0000-0000-000000000003') $$,
  'P0002',
  'That shift no longer exists',
  'somebody outside the organisation is not told the id was real'
);

reset role;

select ok(
  not has_function_privilege('anon', 'public.claim_open_shift(uuid)', 'EXECUTE'),
  'and anon cannot claim anything'
);

select * from finish();
rollback;
