-- =====================================================================
-- subscription_grace_window.test.sql — CAP-041
--
-- A failed payment set `subscriptions.status = 'past_due'` and nothing
-- else. Nobody could tell a card that bounced this morning from a
-- fortnight of retries, and an owner could only be shown the status
-- back — an alarm with no date and no action.
--
--   1. a healthy subscription carries no window;
--   2. going past_due opens one, with a deadline;
--   3. a SECOND failed payment inside the same run does not restart the
--      clock. This is the assertion that matters: without it, a card
--      retried weekly is never actually at risk and the date on screen
--      is permanently a fortnight away;
--   4. recovering to active clears both columns — a stale deadline is
--      the same class of lie as the wrong status;
--   5. so does cancelling;
--   6. an INSERT that starts past_due gets a window too, because OLD is
--      unassigned on insert and a trigger that read it there would
--      raise rather than default.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(6);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000',
  'e0111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
  'owner-grace@example.test', 'x', now(), now(), now(),
  '{"provider":"email"}'::jsonb, '{}'::jsonb;

insert into public.organisations (id, name, slug, created_by, plan) values
  ('e0000000-0000-0000-0000-000000000001', 'Org Grace', 'org-grace',
   'e0111111-1111-1111-1111-111111111111', 'professional');

insert into public.subscriptions (org_id, plan, status) values
  ('e0000000-0000-0000-0000-000000000001', 'professional', 'active');

select ok(
  (select grace_until is null and past_due_since is null
     from public.subscriptions
    where org_id = 'e0000000-0000-0000-0000-000000000001'),
  'a healthy subscription carries no grace window'
);

update public.subscriptions set status = 'past_due'
 where org_id = 'e0000000-0000-0000-0000-000000000001';

select ok(
  (select past_due_since is not null and grace_until > timezone('utc', now())
     from public.subscriptions
    where org_id = 'e0000000-0000-0000-0000-000000000001'),
  'going past due opens a window with a deadline in the future'
);

-- The assertion the design hangs on. Backdate the window, then fail again:
-- the deadline must not move.
update public.subscriptions
   set past_due_since = timezone('utc', now()) - interval '10 days',
       grace_until    = timezone('utc', now()) + interval '4 days'
 where org_id = 'e0000000-0000-0000-0000-000000000001';

update public.subscriptions set status = 'past_due'
 where org_id = 'e0000000-0000-0000-0000-000000000001';

select ok(
  (select grace_until < timezone('utc', now()) + interval '5 days'
     from public.subscriptions
    where org_id = 'e0000000-0000-0000-0000-000000000001'),
  'a second failed payment does not restart the clock — otherwise a weekly retry is never at risk'
);

update public.subscriptions set status = 'active'
 where org_id = 'e0000000-0000-0000-0000-000000000001';

select ok(
  (select grace_until is null and past_due_since is null
     from public.subscriptions
    where org_id = 'e0000000-0000-0000-0000-000000000001'),
  'recovering clears the window rather than leaving a warning on screen'
);

update public.subscriptions set status = 'past_due'
 where org_id = 'e0000000-0000-0000-0000-000000000001';
update public.subscriptions set status = 'canceled'
 where org_id = 'e0000000-0000-0000-0000-000000000001';

select ok(
  (select grace_until is null
     from public.subscriptions
    where org_id = 'e0000000-0000-0000-0000-000000000001'),
  'and so does cancelling'
);

-- Straight to past_due on INSERT. OLD is unassigned there, so a trigger that
-- read it would raise rather than default — this is the case that catches it.
insert into public.organisations (id, name, slug, created_by, plan) values
  ('e0000000-0000-0000-0000-000000000002', 'Org Grace Two', 'org-grace-two',
   'e0111111-1111-1111-1111-111111111111', 'professional');

insert into public.subscriptions (org_id, plan, status) values
  ('e0000000-0000-0000-0000-000000000002', 'professional', 'past_due');

select ok(
  (select grace_until is not null
     from public.subscriptions
    where org_id = 'e0000000-0000-0000-0000-000000000002'),
  'a subscription inserted already past due gets a window too'
);

select * from finish();
rollback;
