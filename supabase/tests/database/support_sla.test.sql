-- =====================================================================
-- support_sla.test.sql — CAP-080
--
-- `support_cases` recorded when the product answered and never when it
-- was supposed to, so a case an hour old and a case a fortnight old sat
-- in the same list at the same weight.
--
--   1. a new case gets its deadlines from its priority;
--   2. an urgent case gets a tighter one than a normal one;
--   3. a case answered in time reads 'met';
--   4. one answered late reads 'breached' — and stays breached, because
--      the recorded response time does not move;
--   5. one not yet answered, past its deadline, is 'breached' too: the
--      state is about the promise, not about whether anybody has typed;
--   6. one approaching its deadline is 'due_soon', which is the state a
--      support queue should be sorted by;
--   7. ESCALATING a late case does not reset its clock. The deadline is
--      recomputed from when the case ARRIVED, so a breach cannot be
--      escalated away — the assertion this design turns on;
--   8. a requester can see the state of their own case;
--   9. and not of somebody else's.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('c1111111-2222-1111-1111-111111111111'::uuid, 'asker-sla@example.test'),
  ('c2222222-2222-1111-1111-111111111111'::uuid, 'other-sla@example.test'),
  ('c4444444-2222-1111-1111-111111111111'::uuid, 'admin-sla@example.test')
) as v(id, email);

update public.profiles set is_platform_admin = true
 where id = 'c4444444-2222-1111-1111-111111111111';

-- A case that arrived two hours ago, at normal priority (24h response).
insert into public.support_cases
  (id, reference, requester_id, requester_email, subject, priority, created_at)
values
  ('c3000000-0000-0000-0000-000000000001', 'SLA-1',
   'c1111111-2222-1111-1111-111111111111', 'asker-sla@example.test',
   'Normal, recent', 'normal', timezone('utc', now()) - interval '2 hours');

select ok(
  (select first_response_due_at is not null and resolution_due_at is not null
     from public.support_cases where id = 'c3000000-0000-0000-0000-000000000001'),
  'a new case gets its deadlines from its priority'
);

insert into public.support_cases
  (id, reference, requester_id, requester_email, subject, priority, created_at)
values
  ('c3000000-0000-0000-0000-000000000002', 'SLA-2',
   'c1111111-2222-1111-1111-111111111111', 'asker-sla@example.test',
   'Urgent, recent', 'urgent', timezone('utc', now()) - interval '2 hours');

select ok(
  (select u.first_response_due_at < n.first_response_due_at
     from public.support_cases u, public.support_cases n
    where u.id = 'c3000000-0000-0000-0000-000000000002'
      and n.id = 'c3000000-0000-0000-0000-000000000001'),
  'an urgent case is promised sooner than a normal one'
);

-- `support_sla_state` is scoped to a platform admin or the case's own
-- requester — with no claims set, `auth.uid()` is null and it correctly
-- returns nothing. So the assertions that read it run as somebody entitled
-- to, which is the point of the last two.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c4444444-2222-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

-- Answered inside the hour.
update public.support_cases
   set first_response_at = created_at + interval '20 minutes'
 where id = 'c3000000-0000-0000-0000-000000000002';

select is(
  (select first_response_state from public.support_sla_state('c3000000-0000-0000-0000-000000000002')),
  'met',
  'a case answered in time reads met'
);

-- Answered, but three hours after a one-hour promise.
insert into public.support_cases
  (id, reference, requester_id, requester_email, subject, priority, created_at)
values
  ('c3000000-0000-0000-0000-000000000003', 'SLA-3',
   'c1111111-2222-1111-1111-111111111111', 'asker-sla@example.test',
   'Urgent, answered late', 'urgent', timezone('utc', now()) - interval '6 hours');
update public.support_cases
   set first_response_at = created_at + interval '3 hours'
 where id = 'c3000000-0000-0000-0000-000000000003';

select is(
  (select first_response_state from public.support_sla_state('c3000000-0000-0000-0000-000000000003')),
  'breached',
  'one answered late reads breached'
);

-- Never answered, six hours old, urgent.
insert into public.support_cases
  (id, reference, requester_id, requester_email, subject, priority, created_at)
values
  ('c3000000-0000-0000-0000-000000000004', 'SLA-4',
   'c1111111-2222-1111-1111-111111111111', 'asker-sla@example.test',
   'Urgent, ignored', 'urgent', timezone('utc', now()) - interval '6 hours');

select is(
  (select first_response_state from public.support_sla_state('c3000000-0000-0000-0000-000000000004')),
  'breached',
  'and one nobody has answered at all is breached too — the state is about the promise'
);

-- 50 minutes into a 60-minute promise.
insert into public.support_cases
  (id, reference, requester_id, requester_email, subject, priority, created_at)
values
  ('c3000000-0000-0000-0000-000000000005', 'SLA-5',
   'c1111111-2222-1111-1111-111111111111', 'asker-sla@example.test',
   'Urgent, nearly due', 'urgent', timezone('utc', now()) - interval '50 minutes');

select is(
  (select first_response_state from public.support_sla_state('c3000000-0000-0000-0000-000000000005')),
  'due_soon',
  'one approaching its deadline is due_soon, which is what a queue should sort by'
);

-- The assertion this design turns on. SLA-4 is six hours old and already
-- breached; escalating it must not hand it a fresh hour.
update public.support_cases set priority = 'urgent'
 where id = 'c3000000-0000-0000-0000-000000000004';
update public.support_cases set priority = 'high'
 where id = 'c3000000-0000-0000-0000-000000000004';

select is(
  (select first_response_state from public.support_sla_state('c3000000-0000-0000-0000-000000000004')),
  'breached',
  'changing the priority of a late case cannot escalate the breach away'
);

-- ── who can see it ────────────────────────────────────────────────────

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1111111-2222-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

select is(
  (select count(*)::int from public.support_sla_state('c3000000-0000-0000-0000-000000000001')),
  1,
  'a requester can see the state of their own case'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c2222222-2222-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

select is(
  (select count(*)::int from public.support_sla_state('c3000000-0000-0000-0000-000000000001')),
  0,
  'and not of somebody else''s'
);

select * from finish();
rollback;
