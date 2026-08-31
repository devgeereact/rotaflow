-- =====================================================================
-- cross_tenant_isolation.test.sql — the Org A / Org B matrix
-- (docs/SAAS.md CAP-045, ❓-003)
--
-- `docs/QA-AUDIT-REPORT.md` called this "the single most critical test
-- in the entire brief" and recorded its verdict as **NOT DETERMINED —
-- BLOCKED**: Org A could never be created, so cross-tenant access was
-- never exercised at all. It has stayed unanswered since, and the
-- register has carried it as a P0 unknown.
--
-- It is answerable here. The audit was blocked because it drove a
-- browser; the question — "can a member of one organisation read or
-- write another's rows" — is a question about RLS, and RLS is testable
-- directly, as the role, with the JWT claims a real session carries.
--
-- ## What this asserts
--
-- Two organisations with no overlap in membership, and one member each.
-- For every table that carries tenant data, B's owner attempts what A's
-- owner may do. The list is deliberately broad rather than
-- representative: an isolation test that checks three tables tells you
-- about three tables.
--
--   READS      staff, locations, rotas, shifts, leave, swaps, clock
--              events, announcements, documents, audit logs, invites,
--              notification outbox
--   WRITES     inserting into another organisation, and updating a row
--              that belongs to one
--   FUNCTIONS  the org-scoped RPCs that take an org id as an argument
--              and could therefore be pointed at somebody else's
--
-- ## Why `set local role authenticated` and not the table owner
--
-- RLS does not apply to the table owner, and every other test in this
-- suite that inserts fixtures relies on that. Here it would defeat the
-- entire point: the assertions run as `authenticated` with a real
-- `sub` claim, which is exactly what PostgREST does for a signed-in
-- user, so what is being measured is what a customer's browser could
-- actually reach.
-- =====================================================================

begin;
select plan(20);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('a0000000-0000-0000-0000-0000000000aa'::uuid, 'owner-a@example.test'),
  ('b0000000-0000-0000-0000-0000000000bb'::uuid, 'owner-b@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('aaaa0000-0000-0000-0000-00000000000a', 'Org A', 'org-a-isolation',
   'a0000000-0000-0000-0000-0000000000aa', 'enterprise'),
  ('bbbb0000-0000-0000-0000-00000000000b', 'Org B', 'org-b-isolation',
   'b0000000-0000-0000-0000-0000000000bb', 'enterprise');

-- Org A's data. Every row below belongs to A and to nobody else.
insert into public.locations (id, org_id, name, timezone) values
  ('aaaa1000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-00000000000a',
   'Ward A', 'Europe/London');

insert into public.staff_profiles (id, org_id, first_name, last_name) values
  ('aaaa2000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-00000000000a',
   'Ada', 'Alpha');

insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status, created_by) values
  ('aaaa3000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-00000000000a',
   'aaaa1000-0000-0000-0000-00000000000a', 'Week 1',
   date '2027-03-01', date '2027-03-07', 'draft',
   'a0000000-0000-0000-0000-0000000000aa');

insert into public.shifts (id, org_id, rota_id, location_id, staff_profile_id, starts_at, ends_at, status) values
  ('aaaa4000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-00000000000a',
   'aaaa3000-0000-0000-0000-00000000000a', 'aaaa1000-0000-0000-0000-00000000000a',
   'aaaa2000-0000-0000-0000-00000000000a',
   timestamptz '2027-03-02 09:00+00', timestamptz '2027-03-02 17:00+00', 'assigned');

insert into public.leave_requests (id, org_id, staff_profile_id, start_date, end_date, status) values
  ('aaaa5000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-00000000000a',
   'aaaa2000-0000-0000-0000-00000000000a', date '2027-04-01', date '2027-04-02', 'pending');

insert into public.shift_swaps (id, org_id, shift_id, requested_by, status) values
  ('aaaa6000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-00000000000a',
   'aaaa4000-0000-0000-0000-00000000000a', 'aaaa2000-0000-0000-0000-00000000000a', 'pending');

insert into public.clock_events (id, org_id, staff_profile_id, type, event_at) values
  ('aaaa7000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-00000000000a',
   'aaaa2000-0000-0000-0000-00000000000a', 'in', timezone('utc', now()));

insert into public.announcements (id, org_id, scope, title, body, published_at) values
  ('aaaa8000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-00000000000a',
   'org', 'Org A only', 'Private to A', now());

insert into public.documents (id, org_id, staff_profile_id, type, name, file_url) values
  ('aaaa9000-0000-0000-0000-00000000000a', 'aaaa0000-0000-0000-0000-00000000000a',
   'aaaa2000-0000-0000-0000-00000000000a', 'dbs', 'DBS', 'https://example.test/a.pdf');

-- ── Everything below runs as ORG B'S OWNER ────────────────────────────
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-0000-0000-0000000000bb', 'role', 'authenticated')::text,
  true);

-- ---------- reads ----------------------------------------------------
select is((select count(*)::int from public.organisations
            where id = 'aaaa0000-0000-0000-0000-00000000000a'), 0,
  'B cannot see A''s organisation row');

select is((select count(*)::int from public.staff_profiles
            where org_id = 'aaaa0000-0000-0000-0000-00000000000a'), 0,
  'B cannot read A''s staff — names, phone numbers, payroll ids');

select is((select count(*)::int from public.locations
            where org_id = 'aaaa0000-0000-0000-0000-00000000000a'), 0,
  'B cannot read A''s sites');

select is((select count(*)::int from public.rotas
            where org_id = 'aaaa0000-0000-0000-0000-00000000000a'), 0,
  'B cannot read A''s rotas');

select is((select count(*)::int from public.shifts
            where org_id = 'aaaa0000-0000-0000-0000-00000000000a'), 0,
  'B cannot read A''s shifts — who works where and when');

select is((select count(*)::int from public.leave_requests
            where org_id = 'aaaa0000-0000-0000-0000-00000000000a'), 0,
  'B cannot read A''s leave requests');

select is((select count(*)::int from public.shift_swaps
            where org_id = 'aaaa0000-0000-0000-0000-00000000000a'), 0,
  'B cannot read A''s swap requests');

select is((select count(*)::int from public.clock_events
            where org_id = 'aaaa0000-0000-0000-0000-00000000000a'), 0,
  'B cannot read A''s clock events — attendance, and the GPS on it');

select is((select count(*)::int from public.announcements
            where org_id = 'aaaa0000-0000-0000-0000-00000000000a'), 0,
  'B cannot read A''s announcements');

select is((select count(*)::int from public.documents
            where org_id = 'aaaa0000-0000-0000-0000-00000000000a'), 0,
  'B cannot read A''s staff documents');

select is((select count(*)::int from public.memberships
            where org_id = 'aaaa0000-0000-0000-0000-00000000000a'), 0,
  'B cannot enumerate A''s members');

select is((select count(*)::int from public.audit_logs
            where org_id = 'aaaa0000-0000-0000-0000-00000000000a'), 0,
  'B cannot read A''s audit trail');

select is((select count(*)::int from public.invites
            where org_id = 'aaaa0000-0000-0000-0000-00000000000a'), 0,
  'B cannot read A''s invitations');

select is((select count(*)::int from public.notification_outbox
            where org_id = 'aaaa0000-0000-0000-0000-00000000000a'), 0,
  'B cannot read what A''s staff are being told');

-- ---------- writes ---------------------------------------------------
--
-- A refused INSERT and a silently-ignored UPDATE are both correct
-- outcomes under RLS, and they look different: a policy violation raises
-- 42501, while an UPDATE whose USING clause matches nothing simply
-- affects zero rows. Both are asserted in the form they actually take.
select throws_ok(
  $$insert into public.staff_profiles (org_id, first_name, last_name)
    values ('aaaa0000-0000-0000-0000-00000000000a', 'Injected', 'Person')$$,
  '42501',
  null,
  'B cannot add a staff member to A');

select throws_ok(
  $$insert into public.shifts (org_id, location_id, starts_at, ends_at, status)
    values ('aaaa0000-0000-0000-0000-00000000000a',
            'aaaa1000-0000-0000-0000-00000000000a',
            timestamptz '2027-03-03 09:00+00', timestamptz '2027-03-03 17:00+00', 'open')$$,
  '42501',
  null,
  'B cannot put a shift on A''s rota');

-- Data-modifying CTEs rather than a DO block: pgTAP's assertions RETURN
-- their TAP line, and the harness reads it out of the result set. A
-- `perform is(...)` inside a DO block runs the assertion and throws the line
-- away, so the plan would come up short and the failure would look like a
-- missing test rather than a swallowed one.
select is(
  (with attempted as (
     update public.staff_profiles set first_name = 'Tampered'
      where org_id = 'aaaa0000-0000-0000-0000-00000000000a'
      returning 1)
   select count(*)::int from attempted),
  0,
  'B''s update of A''s staff matches no rows rather than succeeding');

select is(
  (with attempted as (
     delete from public.shifts
      where org_id = 'aaaa0000-0000-0000-0000-00000000000a'
      returning 1)
   select count(*)::int from attempted),
  0,
  'and B''s delete of A''s shifts removes nothing');

-- ---------- functions ------------------------------------------------
--
-- The RPCs are the other door. Every one of these takes an org id as an
-- argument, so a caller can name somebody else's — and `is_org_member`
-- inside them is what makes that safe. A table-level policy does not help
-- if a SECURITY DEFINER function skips the check.
select ok(
  not public.is_org_member('aaaa0000-0000-0000-0000-00000000000a'),
  'is_org_member says no for another organisation — the predicate everything else rests on');

select is(
  (select count(*)::int from public.my_feature_access('aaaa0000-0000-0000-0000-00000000000a')),
  0,
  'and an org-scoped RPC returns nothing for one the caller is not in');

reset role;
select * from finish();
rollback;
