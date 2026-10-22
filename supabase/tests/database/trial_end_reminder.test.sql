-- =====================================================================
-- trial_end_reminder.test.sql: an owner hears that the free trial is
-- ending before it ends (0157, docs/SAAS.md GAP-127)
--
-- What has to hold, and the way each could be wrong:
--
--   1. a trial ending in two days, with no plan chosen, queues exactly
--      one `billing/trial_ending` notice;
--   2. it is addressed to the owner alone: choosing a plan is the
--      owner's, and a manager told about it can do nothing;
--   3. it is a billing notice, so send-notification emails it under the
--      owner's channel preferences;
--   4. running the job again queues nothing: it runs every fifteen
--      minutes, and without dedupe the owner would get 288 reminders;
--   5. a trial ending in ten days queues nothing yet;
--   6. an organisation that has already chosen a plan is not chased;
--   7. a suspended organisation is not sold to;
--   8. a trial that has already ended queues nothing: the read-only
--      banner covers that, and "ends on" a past date would be wrong.
--
-- Shown to fail on the real defect: with 0157 reverted, assertion 1
-- counts zero rows.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('7e000000-0000-0000-0000-0000000000a1'::uuid, 'owner-ending@example.test'),
  ('7e000000-0000-0000-0000-0000000000a2'::uuid, 'manager-ending@example.test'),
  ('7e000000-0000-0000-0000-0000000000b1'::uuid, 'owner-later@example.test'),
  ('7e000000-0000-0000-0000-0000000000c1'::uuid, 'owner-paid@example.test'),
  ('7e000000-0000-0000-0000-0000000000d1'::uuid, 'owner-suspended@example.test'),
  ('7e000000-0000-0000-0000-0000000000e1'::uuid, 'owner-ended@example.test')
) as v(id, email);

-- The creation path makes the creator the owner, as it does for every
-- organisation.
insert into public.organisations (id, name, slug, created_by) values
  ('7e001000-0000-0000-0000-0000000000a0', 'Ending Soon Ltd', 'ending-soon',
   '7e000000-0000-0000-0000-0000000000a1'),
  ('7e001000-0000-0000-0000-0000000000b0', 'Ending Later Ltd', 'ending-later',
   '7e000000-0000-0000-0000-0000000000b1'),
  ('7e001000-0000-0000-0000-0000000000c0', 'Already Paid Ltd', 'already-paid',
   '7e000000-0000-0000-0000-0000000000c1'),
  ('7e001000-0000-0000-0000-0000000000d0', 'Suspended Ltd', 'suspended-trial',
   '7e000000-0000-0000-0000-0000000000d1'),
  ('7e001000-0000-0000-0000-0000000000e0', 'Ended Ltd', 'ended-trial',
   '7e000000-0000-0000-0000-0000000000e1');

insert into public.memberships (org_id, user_id, role, status) values
  ('7e001000-0000-0000-0000-0000000000a0', '7e000000-0000-0000-0000-0000000000a2', 'manager', 'active');

-- Trial ends relative to now(), so the test does not rot as the clock
-- moves. Written as the database owner: the browser cannot set them.
update public.organisations set trial_ends_at = now() + interval '2 days'
 where id in ('7e001000-0000-0000-0000-0000000000a0',
              '7e001000-0000-0000-0000-0000000000c0',
              '7e001000-0000-0000-0000-0000000000d0');
update public.organisations set trial_ends_at = now() + interval '10 days'
 where id = '7e001000-0000-0000-0000-0000000000b0';
update public.organisations set trial_ends_at = now() - interval '1 day'
 where id = '7e001000-0000-0000-0000-0000000000e0';
update public.organisations set status = 'suspended', suspended_at = now()
 where id = '7e001000-0000-0000-0000-0000000000d0';

insert into public.subscriptions (org_id, plan, status, provider, provider_ref, stripe_mode)
values ('7e001000-0000-0000-0000-0000000000c0', 'starter', 'active', 'stripe',
        'sub_trial_reminder_test', 'test');

select public.enqueue_scheduled_alerts();

select is(
  (select count(*)::int from public.notification_outbox
    where event_name = 'billing/trial_ending'
      and org_id = '7e001000-0000-0000-0000-0000000000a0'),
  1,
  'a trial ending in two days with no plan queues one reminder'
);

select is(
  (select payload->'userIds' from public.notification_outbox
    where event_name = 'billing/trial_ending'
      and org_id = '7e001000-0000-0000-0000-0000000000a0'),
  '["7e000000-0000-0000-0000-0000000000a1"]'::jsonb,
  'the reminder goes to the owner and not the manager'
);

select is(
  (select payload->>'type' from public.notification_outbox
    where event_name = 'billing/trial_ending'
      and org_id = '7e001000-0000-0000-0000-0000000000a0'),
  'billing',
  'it is a billing notice, so it is emailed under the owner''s preferences'
);

select public.enqueue_scheduled_alerts();

select is(
  (select count(*)::int from public.notification_outbox
    where event_name = 'billing/trial_ending'
      and org_id = '7e001000-0000-0000-0000-0000000000a0'),
  1,
  'running the job again queues nothing more'
);

select is(
  (select count(*)::int from public.notification_outbox
    where event_name = 'billing/trial_ending'
      and org_id = '7e001000-0000-0000-0000-0000000000b0'),
  0,
  'a trial ending in ten days queues nothing yet'
);

select is(
  (select count(*)::int from public.notification_outbox
    where event_name = 'billing/trial_ending'
      and org_id = '7e001000-0000-0000-0000-0000000000c0'),
  0,
  'an organisation that has chosen a plan is not chased'
);

select is(
  (select count(*)::int from public.notification_outbox
    where event_name = 'billing/trial_ending'
      and org_id = '7e001000-0000-0000-0000-0000000000d0'),
  0,
  'a suspended organisation is not sent a reminder'
);

select is(
  (select count(*)::int from public.notification_outbox
    where event_name = 'billing/trial_ending'
      and org_id = '7e001000-0000-0000-0000-0000000000e0'),
  0,
  'a trial that has already ended queues nothing'
);

select * from finish();
rollback;
