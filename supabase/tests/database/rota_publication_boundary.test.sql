-- =====================================================================
-- rota_publication_boundary.test.sql — DRAFT ≠ PUBLISHED, asserted
-- where it is enforced (docs/SAAS.md GAP-039, migration 0114)
--
-- Until 0114 this boundary lived in `src/services/shiftService.ts` as a
-- `.filter()` applied after the rows had arrived, so a staff member with
-- a browser console — or any HTTP client and their own access token —
-- could read next week's unpublished draft: who is being cut, who is
-- being moved to nights, who is not on it at all.
--
-- The assertions run as `authenticated` with a real `sub` claim rather
-- than as the table owner, because RLS does not apply to the owner and
-- the whole question here is what a customer's session can reach.
--
-- Both directions are asserted. A policy that hides drafts from everyone
-- would pass the first three and break the product, so the manager's
-- view is checked too, and so is `archived` — a staff member's own
-- history is archived the moment a week is amended, and losing it would
-- be a worse bug than the one being fixed.
-- =====================================================================

begin;
select plan(7);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('bd000000-0000-0000-0000-0000000000b1'::uuid, 'owner-boundary@example.test'),
  ('bd000000-0000-0000-0000-0000000000b2'::uuid, 'staff-boundary@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('bd001000-0000-0000-0000-0000000000b0', 'Boundary Ltd', 'boundary-ltd',
   'bd000000-0000-0000-0000-0000000000b1', 'enterprise');

insert into public.memberships (org_id, user_id, role, status) values
  ('bd001000-0000-0000-0000-0000000000b0', 'bd000000-0000-0000-0000-0000000000b2', 'staff', 'active');

insert into public.locations (id, org_id, name, timezone) values
  ('bd002000-0000-0000-0000-0000000000b0', 'bd001000-0000-0000-0000-0000000000b0',
   'Main site', 'Europe/London');

insert into public.staff_profiles (id, org_id, user_id, first_name, last_name) values
  ('bd003000-0000-0000-0000-0000000000b0', 'bd001000-0000-0000-0000-0000000000b0',
   'bd000000-0000-0000-0000-0000000000b2', 'Sam', 'Staff');

-- one rota in each state, each with a shift on it
insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status, created_by) values
  ('bd004000-0000-0000-0000-00000000000d', 'bd001000-0000-0000-0000-0000000000b0',
   'bd002000-0000-0000-0000-0000000000b0', 'Next week, still being written',
   date '2027-06-07', date '2027-06-13', 'draft',     'bd000000-0000-0000-0000-0000000000b1'),
  ('bd004000-0000-0000-0000-0000000000cf', 'bd001000-0000-0000-0000-0000000000b0',
   'bd002000-0000-0000-0000-0000000000b0', 'This week, published',
   date '2027-05-31', date '2027-06-06', 'published', 'bd000000-0000-0000-0000-0000000000b1'),
  ('bd004000-0000-0000-0000-00000000000a', 'bd001000-0000-0000-0000-0000000000b0',
   'bd002000-0000-0000-0000-0000000000b0', 'Last week, since amended',
   date '2027-05-24', date '2027-05-30', 'archived',  'bd000000-0000-0000-0000-0000000000b1');

insert into public.shifts (id, org_id, rota_id, location_id, staff_profile_id, starts_at, ends_at, status) values
  ('bd005000-0000-0000-0000-00000000000d', 'bd001000-0000-0000-0000-0000000000b0',
   'bd004000-0000-0000-0000-00000000000d', 'bd002000-0000-0000-0000-0000000000b0',
   'bd003000-0000-0000-0000-0000000000b0',
   timestamptz '2027-06-08 22:00+00', timestamptz '2027-06-09 06:00+00', 'assigned'),
  ('bd005000-0000-0000-0000-0000000000cf', 'bd001000-0000-0000-0000-0000000000b0',
   'bd004000-0000-0000-0000-0000000000cf', 'bd002000-0000-0000-0000-0000000000b0',
   'bd003000-0000-0000-0000-0000000000b0',
   timestamptz '2027-06-01 09:00+00', timestamptz '2027-06-01 17:00+00', 'assigned'),
  ('bd005000-0000-0000-0000-00000000000a', 'bd001000-0000-0000-0000-0000000000b0',
   'bd004000-0000-0000-0000-00000000000a', 'bd002000-0000-0000-0000-0000000000b0',
   'bd003000-0000-0000-0000-0000000000b0',
   timestamptz '2027-05-25 09:00+00', timestamptz '2027-05-25 17:00+00', 'assigned');

-- a shift with no rota at all: nullable `rota_id` (0002:199) has no
-- publication state to hide behind, and stays visible to the org.
insert into public.shifts (id, org_id, rota_id, location_id, staff_profile_id, starts_at, ends_at, status) values
  ('bd005000-0000-0000-0000-0000000000ce', 'bd001000-0000-0000-0000-0000000000b0',
   null, 'bd002000-0000-0000-0000-0000000000b0', 'bd003000-0000-0000-0000-0000000000b0',
   timestamptz '2027-06-02 09:00+00', timestamptz '2027-06-02 17:00+00', 'assigned');

-- ── as the STAFF member ──────────────────────────────────────────────
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'bd000000-0000-0000-0000-0000000000b2', 'role', 'authenticated')::text,
  true);

select is(
  (select count(*)::int from public.rotas where status = 'draft'),
  0,
  'a staff member cannot see a draft rota'
);

select is(
  (select count(*)::int from public.shifts s
     join public.rotas r on r.id = s.rota_id
    where r.status = 'draft'),
  0,
  'nor the shifts on one, which is where the hours actually are'
);

select is(
  (select count(*)::int from public.rotas where status = 'published'),
  1,
  'the published rota is still theirs to read'
);

select is(
  (select count(*)::int from public.rotas where status = 'archived'),
  1,
  'and so is an archived one — that is their own history, not a draft'
);

select is(
  (select count(*)::int from public.shifts where rota_id is null),
  1,
  'a shift with no rota has no publication state to hide behind'
);

-- ── as the OWNER ─────────────────────────────────────────────────────
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'bd000000-0000-0000-0000-0000000000b1', 'role', 'authenticated')::text,
  true);

select is(
  (select count(*)::int from public.rotas),
  3,
  'the owner still sees all three, including the draft they are writing'
);

select is(
  (select count(*)::int from public.shifts),
  4,
  'and every shift on them — a rota nobody can build is not a fix'
);

select * from finish();
rollback;
