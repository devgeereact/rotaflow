-- =====================================================================
-- clock_corrections_are_kept.test.sql — the contract `0128` put in place.
--
-- `clock_events` rows become somebody's pay. Before this migration a
-- manager could write over one directly: RLS allowed it, no reason was
-- recorded, the previous value was gone, and two managers editing the
-- same row each believed they had won. `clockService` said so in its own
-- comment — "`updated_at` is the only trace that a correction happened".
--
-- What is asserted here is the half no unit test can reach:
--
--   1. the direct UPDATE path is closed, so the audited one is not
--      optional;
--   2. a correction records the row either side, the actor and the reason,
--      into a table no client may write to, update or delete;
--   3. a correction with no reason is refused;
--   4. a stale write — one whose `expected_updated_at` no longer matches —
--      is refused rather than silently discarding somebody else's;
--   5. a correction inside an APPROVED period flags it for a fresh
--      decision and does NOT move the total somebody signed;
--   6. a manager of another organisation cannot correct these events, and
--      cannot read the history either.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(14);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('c2111111-1111-1111-1111-111111111111'::uuid, 'cc-owner@example.test'),
  ('c2222222-2222-2222-2222-222222222222'::uuid, 'cc-outsider@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('c2000000-0000-0000-0000-000000000001', 'Corrections A', 'corrections-a',
   'c2111111-1111-1111-1111-111111111111', 'starter'),
  ('c2000000-0000-0000-0000-000000000002', 'Corrections B', 'corrections-b',
   'c2222222-2222-2222-2222-222222222222', 'starter');

insert into public.staff_profiles (id, org_id, first_name, last_name)
values ('c2b00000-0000-0000-0000-000000000001',
        'c2000000-0000-0000-0000-000000000001', 'Marcus', 'Webb');

insert into public.clock_events (id, org_id, staff_profile_id, type, event_at, method)
values ('c2c00000-0000-0000-0000-000000000001',
        'c2000000-0000-0000-0000-000000000001',
        'c2b00000-0000-0000-0000-000000000001',
        'in', timezone('utc', now()) - interval '3 hours', 'gps');

-- ---------- 1. the unaudited path is closed ---------------------------
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'clock_events'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  0,
  'a tenant session holds no direct UPDATE on clock_events'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'clock_events'
      and policyname = 'clock_events_update'),
  0,
  'and the policy that used to allow it is gone, so neither is the effective control'
);

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'clock_event_corrections'
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'and no client may write, edit or delete the history — only the definer function does'
);

-- ---------- 2. a correction keeps the evidence ------------------------
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c2111111-1111-1111-1111-111111111111',
                    'role', 'authenticated')::text,
  true);

-- Captured before the correction, so the assertions below compare against
-- what the row actually held rather than against a literal the 0068 guard
-- may have clamped on insert.
create temporary table original on commit drop as
select event_at, updated_at from public.clock_events
 where id = 'c2c00000-0000-0000-0000-000000000001';

create temporary table corrected on commit drop as
select public.correct_clock_event(
  'c2c00000-0000-0000-0000-000000000001',
  'Clock terminal was ten minutes slow all morning.',
  (select event_at from original) - interval '10 minutes',
  null,
  (select updated_at from original)
) as row;

select is(
  (select event_at from public.clock_events
    where id = 'c2c00000-0000-0000-0000-000000000001'),
  (select event_at - interval '10 minutes' from original),
  'the correction is applied'
);

select is(
  (select count(*)::int from public.clock_event_corrections
    where clock_event_id = 'c2c00000-0000-0000-0000-000000000001'),
  1,
  'and one history row is written'
);

select is(
  (select (before_value ->> 'event_at')::timestamptz
     from public.clock_event_corrections
    where clock_event_id = 'c2c00000-0000-0000-0000-000000000001'),
  (select event_at from original),
  'carrying the value it had before — which the row itself no longer holds'
);

select is(
  (select actor_user_id from public.clock_event_corrections
    where clock_event_id = 'c2c00000-0000-0000-0000-000000000001'),
  'c2111111-1111-1111-1111-111111111111'::uuid,
  'and who made it'
);

-- ---------- 3. a reason is compulsory ---------------------------------
select throws_ok(
  $$select public.correct_clock_event(
      'c2c00000-0000-0000-0000-000000000001', '  ', timezone('utc', now()))$$,
  'CLK04',
  null,
  'a correction with no reason is refused'
);

-- ---------- 4. a stale write is refused -------------------------------
select throws_ok(
  $$select public.correct_clock_event(
      'c2c00000-0000-0000-0000-000000000001',
      'Second manager, working from a stale screen.',
      timezone('utc', now()),
      null,
      '2020-01-01T00:00:00Z'::timestamptz)$$,
  'CLK05',
  null,
  'a second manager whose view is stale is refused rather than overwriting the first'
);

select is(
  (select event_at from public.clock_events
    where id = 'c2c00000-0000-0000-0000-000000000001'),
  (select event_at - interval '10 minutes' from original),
  'and the first correction stands'
);

-- ---------- 5. an approved period is flagged, not rewritten -----------
reset role;
select set_config('request.jwt.claims', '', true);

insert into public.timesheets (
  id, org_id, staff_profile_id, period_start, period_end, total_minutes, status)
values ('c2d00000-0000-0000-0000-000000000001',
        'c2000000-0000-0000-0000-000000000001',
        'c2b00000-0000-0000-0000-000000000001',
        (timezone('utc', now()) - interval '3 hours')::date - 1,
        (timezone('utc', now()) - interval '3 hours')::date + 1,
        2250, 'approved');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c2111111-1111-1111-1111-111111111111',
                    'role', 'authenticated')::text,
  true);

select public.correct_clock_event(
  'c2c00000-0000-0000-0000-000000000001',
  'Payroll queried the start time.',
  (select event_at from public.clock_events
    where id = 'c2c00000-0000-0000-0000-000000000001') - interval '5 minutes',
  null,
  (select updated_at from public.clock_events
    where id = 'c2c00000-0000-0000-0000-000000000001'));

select isnt(
  (select recalculation_required_at from public.timesheets
    where id = 'c2d00000-0000-0000-0000-000000000001'),
  null,
  'a correction inside an approved period asks for a fresh decision'
);

select is(
  (select total_minutes from public.timesheets
    where id = 'c2d00000-0000-0000-0000-000000000001'),
  2250,
  'and does NOT move the total somebody signed off'
);

-- ---------- 6. another tenant is refused ------------------------------
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c2222222-2222-2222-2222-222222222222',
                    'role', 'authenticated')::text,
  true);

select throws_ok(
  $$select public.correct_clock_event(
      'c2c00000-0000-0000-0000-000000000001',
      'Not my organisation.',
      timezone('utc', now()))$$,
  '42501',
  null,
  'an owner of a different organisation cannot correct these events'
);

select is(
  (select count(*)::int from public.clock_event_corrections),
  0,
  'and cannot read the history either'
);

select * from finish();
rollback;
