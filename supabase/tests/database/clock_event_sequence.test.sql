-- =====================================================================
-- clock_event_sequence.test.sql — a second clock-in is not a clock-in
-- (docs/SAAS.md GAP-040, migration 0115)
--
-- Before 0115 nothing on the server refused a duplicate. Measured on a
-- local stack as the staff member's own session: three consecutive `in`
-- rows, no `out` between them, all three accepted.
--
-- The damage is not a crash. `pairClockEvents` absorbs it into a
-- zero-minute segment flagged `missing_clock_out`, on a timesheet a
-- manager approves for payroll.
--
-- Half of this file asserts what the guard REFUSES. The other half
-- asserts what it must not: the narrowness is the design, not an
-- oversight, and a later "tightening" that broke it would otherwise pass.
-- =====================================================================

begin;
select plan(6);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('c1000000-0000-0000-0000-0000000000c1'::uuid, 'owner-clockseq@example.test'),
  ('c1000000-0000-0000-0000-0000000000c2'::uuid, 'staff-clockseq@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('c1001000-0000-0000-0000-0000000000c0', 'Clock Sequence Ltd', 'clock-sequence-ltd',
   'c1000000-0000-0000-0000-0000000000c1', 'enterprise');

insert into public.memberships (org_id, user_id, role, status) values
  ('c1001000-0000-0000-0000-0000000000c0', 'c1000000-0000-0000-0000-0000000000c2', 'staff', 'active');

insert into public.staff_profiles (id, org_id, user_id, first_name, last_name) values
  ('c1002000-0000-0000-0000-0000000000c0', 'c1001000-0000-0000-0000-0000000000c0',
   'c1000000-0000-0000-0000-0000000000c2', 'Cass', 'Clock');

-- ── as the STAFF member ──────────────────────────────────────────────
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-0000000000c2', 'role', 'authenticated')::text,
  true);

insert into public.clock_events (org_id, staff_profile_id, type, method, event_at)
values ('c1001000-0000-0000-0000-0000000000c0', 'c1002000-0000-0000-0000-0000000000c0',
        'in', 'manual', timezone('utc', now()) - interval '30 seconds');

-- 1: the case this exists for — a double tap, or an outbox flushed twice.
select throws_ok(
  $$insert into public.clock_events (org_id, staff_profile_id, type, method, event_at)
    values ('c1001000-0000-0000-0000-0000000000c0', 'c1002000-0000-0000-0000-0000000000c0',
            'in', 'manual', timezone('utc', now()))$$,
  'CLK01',
  'You are already clocked in.',
  'a second clock-in seconds after the first is refused'
);

-- 2: and the narrowness is the design. Somebody who forgot to clock out
-- last night must still be able to start today, or the guard has taken
-- their shift off them to protect a timesheet.
select lives_ok(
  $$insert into public.clock_events (org_id, staff_profile_id, type, method, event_at)
    values ('c1001000-0000-0000-0000-0000000000c0', 'c1002000-0000-0000-0000-0000000000c0',
            'in', 'manual', timezone('utc', now()) - interval '20 minutes')$$,
  'a clock-in well after an open session is allowed — that is a missed clock-out, and the timesheet flags it'
);

-- 3: nothing guards `out`. 0068 clamps an offline `in` forward, which can
-- reorder it after a genuine `out`, so any ordering rule on `out` can
-- refuse a real one. A person must never be unable to clock out.
select lives_ok(
  $$insert into public.clock_events (org_id, staff_profile_id, type, method, event_at)
    values ('c1001000-0000-0000-0000-0000000000c0', 'c1002000-0000-0000-0000-0000000000c0',
            'out', 'manual', timezone('utc', now()) - interval '9 hours')$$,
  'a clock-out with nothing open is accepted — guard the fabrication, never the exit'
);

-- 4: a replay must reach 0081's unique index, not this guard. A dead
-- letter tells the person "this did not happen, do it again", which for
-- a clock-in that DID land is the worst answer available.
insert into public.clock_events (org_id, staff_profile_id, type, method, event_at, client_event_id)
values ('c1001000-0000-0000-0000-0000000000c0', 'c1002000-0000-0000-0000-0000000000c0',
        'break_start', 'manual', timezone('utc', now()) - interval '3 minutes',
        'c1003000-0000-0000-0000-0000000000c0');

select throws_ok(
  $$insert into public.clock_events (org_id, staff_profile_id, type, method, event_at, client_event_id)
    values ('c1001000-0000-0000-0000-0000000000c0', 'c1002000-0000-0000-0000-0000000000c0',
            'in', 'manual', timezone('utc', now()), 'c1003000-0000-0000-0000-0000000000c0')$$,
  '23505',
  NULL,
  'a replay of a landed write raises the unique violation the outbox reads as "already applied", not CLK01'
);

-- ── as the OWNER ─────────────────────────────────────────────────────
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1000000-0000-0000-0000-0000000000c1', 'role', 'authenticated')::text,
  true);

-- 5: a manager correcting attendance has to be able to insert the very
-- row the guard refuses. 0037's UPDATE policy is what gates them.
select lives_ok(
  $$insert into public.clock_events (org_id, staff_profile_id, type, method, event_at)
    values ('c1001000-0000-0000-0000-0000000000c0', 'c1002000-0000-0000-0000-0000000000c0',
            'in', 'manual', timezone('utc', now()))$$,
  'an owner is exempt — amending somebody''s attendance is their job'
);

-- 6: the index the guard reads on every staff-side insert.
select has_index(
  'public', 'clock_events', 'clock_events_staff_event_at_idx',
  'the lookup is indexed, so a busy site does not sequentially scan once per clock-in'
);

select * from finish();
rollback;
