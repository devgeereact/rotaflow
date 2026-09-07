-- =====================================================================
-- announcement_delivery.test.sql — a platform announcement is queued
-- through the outbox, a scheduled one actually publishes, and a delivery
-- is not called sent until something carried it (0132)
--
-- ## The defects
--
-- `publish_platform_announcement` (0025) stamped
-- `sent_at = timezone('utc', now())` on every delivery row at insert, so
-- every recipient was recorded as delivered before anything had sent
-- anything — against 0025's own header, which says `sent_at` is "stamped
-- by whatever actually sent it". Nothing ever did: fan-out was deferred
-- to an Edge Function that was never written, while
-- `notification_outbox` had been draining rota publications through
-- `send-notification` since 0069. And `status = 'scheduled'` was read by
-- no job at all, so a scheduled announcement sat there forever.
--
-- ## Shown to fail on the real defects
--
-- Assertion 4 fails against 0025: the delivery arrives with `sent_at`
-- already set, so `queued` is 0 and `delivered` is 2.
-- Assertion 8 fails against 0025: the scheduled announcement is still
-- 'scheduled' after the due-publisher runs, because there was no
-- publisher.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(15);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-0000000000a1',
   'authenticated', 'authenticated', 'ann-owner@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-0000000000b2',
   'authenticated', 'authenticated', 'tenant-owner-1@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-0000000000c3',
   'authenticated', 'authenticated', 'tenant-owner-2@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}');

insert into public.platform_admins (user_id, role)
values ('f0000000-0000-0000-0000-0000000000a1', 'platform_owner');

-- Two tenants with an owner, and one with nobody to address.
insert into public.organisations (id, name, slug, plan, created_by) values
  ('f1000000-0000-0000-0000-000000000001', 'Reach One', 'reach-one', 'business',
   'f0000000-0000-0000-0000-0000000000b2'),
  ('f1000000-0000-0000-0000-000000000002', 'Reach Two', 'reach-two', 'business',
   'f0000000-0000-0000-0000-0000000000c3'),
  ('f1000000-0000-0000-0000-000000000003', 'Nobody Home', 'nobody-home', 'starter',
   null);

create or replace function pg_temp.become(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true);
$$;

set local role authenticated;
select pg_temp.become('f0000000-0000-0000-0000-0000000000a1');

-- ---------- 1-3. compose and publish ----------------------------------
select lives_ok(
  $$ select public.create_platform_announcement(
       'Maintenance window', 'We will be down for ten minutes.', 'maintenance') $$,
  'a platform owner can compose an announcement');

-- The console disabled its composer with "There is no announcement table
-- to write to" while listing rows from that table. There is one, and this
-- is it.
select is(
  (select count(*)::int from public.platform_announcements where status = 'draft'),
  1,
  'and it lands as a draft rather than going out immediately');

select is(
  public.publish_platform_announcement(
    (select id from public.platform_announcements where status = 'draft')),
  3,
  'publishing addresses every active organisation');

-- ---------- 4-6. queued is not sent -----------------------------------
select is(
  (select queued::int from public.platform_announcement_stats(
     array(select id from public.platform_announcements))),
  2,
  'the two reachable organisations are QUEUED, not recorded as delivered');

select is(
  (select delivered::int from public.platform_announcement_stats(
     array(select id from public.platform_announcements))),
  0,
  'nothing is delivered until something carries it');

select is(
  (select failed::int from public.platform_announcement_stats(
     array(select id from public.platform_announcements))),
  1,
  'and the organisation with no owner or manager is a recorded failure, not a silence');

-- ---------- 7. the dispatch is real, not a placeholder ----------------
-- Counted as `postgres`: `notification_outbox_select` (0069) admits an
-- organisation's own owners and managers, and a platform administrator is
-- neither. RLS filtering this to zero for the reader is correct; it is not
-- evidence that nothing was queued.
set local role postgres;

select is(
  (select count(*)::int from public.notification_outbox
    where event_name = 'platform/announcement'),
  2,
  'one outbox row per reachable organisation, on the queue that already drains');

set local role authenticated;
select pg_temp.become('f0000000-0000-0000-0000-0000000000a1');

-- ---------- 8-10. a scheduled announcement publishes ------------------
select lives_ok(
  $$ select public.create_platform_announcement(
       'Release notes', 'New rota grid.', 'product', 'all', '{}', 'in_app',
       timezone('utc', now()) - interval '1 minute') $$,
  'an announcement can be scheduled for a time that has passed');

set local role postgres;
select is(
  public.publish_due_platform_announcements(),
  1,
  'the scheduler publishes it — storing scheduled_for is not scheduling');

select is(
  (select status from public.platform_announcements where title = 'Release notes'),
  'sent',
  'and the row says so afterwards');

-- ---------- 11. reconciliation is what marks a delivery sent ----------
update public.notification_outbox
   set status = 'sent', dispatched_at = timezone('utc', now())
 where event_name = 'platform/announcement';

select is(
  public.reconcile_announcement_deliveries(),
  4,
  'a confirmed dispatch is what stamps the delivery, on both announcements');

set local role authenticated;
select pg_temp.become('f0000000-0000-0000-0000-0000000000a1');

select is(
  (select sum(delivered)::int from public.platform_announcement_stats(
     array(select id from public.platform_announcements))),
  4,
  'and only then does the console count them as delivered');

-- ---------- 13. publishing twice does not double-deliver --------------
select throws_ok(
  format($$ select public.publish_platform_announcement(%L) $$,
         (select id from public.platform_announcements where title = 'Release notes')),
  '22023',
  'That announcement has already been sent',
  'and publishing an already-sent announcement is refused outright');

-- ---------- 14-15. cancelling ------------------------------------------
select lives_ok(
  $$ select public.cancel_platform_announcement(
       public.create_platform_announcement('Draft to drop', 'Never mind.', 'product')) $$,
  'a draft can be cancelled — 0025 gave the status a CHECK value and nothing that set it');

select throws_ok(
  format($$ select public.cancel_platform_announcement(%L) $$,
         (select id from public.platform_announcements where title = 'Release notes')),
  '22023',
  'That announcement has already been sent and cannot be cancelled',
  'but a sent one cannot be unsent, because recipients are already holding it');

select * from finish();
rollback;
