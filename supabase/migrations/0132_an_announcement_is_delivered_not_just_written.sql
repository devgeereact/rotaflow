-- =====================================================================
-- 0132_an_announcement_is_delivered_not_just_written.sql — a platform
-- announcement is queued through the notification outbox, a scheduled
-- one actually publishes, and a delivery is only "sent" once something
-- carried it
--
-- ## Three things `0025` left, and one the console said about it
--
-- **1. `sent_at` was stamped at insert.** `publish_platform_announcement`
-- wrote every delivery row with `sent_at = timezone('utc', now())`, so
-- every recipient was recorded as delivered the instant the row was
-- created — before, and regardless of, anything carrying the message.
-- `0025`'s own header says the opposite in as many words:
--
--     "`sent_at` on the delivery is stamped by whatever actually sent it
--      — so an unsent row is visibly unsent rather than assumed
--      delivered."
--
-- The table was built for the honest version and the function did not
-- implement it. The Deliveries tile on `/admin/notifications` therefore
-- counted intentions and called them deliveries.
--
-- **2. Nothing sent anything.** `0025` deferred fan-out to "an Edge
-- Function's job" and none was written. There is one now and it has been
-- there since `0069`: `notification_outbox` is drained every minute by
-- `dispatch_notification_outbox()` into `send-notification`, which
-- creates the in-app rows and delivers by email and push under each
-- organisation's own settings. `send-notification` already maps
-- `type: 'announcement'` to the `announcements` event key. Nothing new
-- had to be built; the announcement path simply never joined the one
-- that works.
--
-- **3. A scheduled announcement was never published.** `status =
-- 'scheduled'` with a `scheduled_for` is a row that sits there forever:
-- no job read it. Storing a time is not scheduling. `pg_cron` now
-- publishes what is due, on the same minute tick the outbox uses.
--
-- **And the console said the table did not exist.** `AdminNotificationsPage`
-- disabled New announcement with the title "There is no announcement
-- table to write to", on a screen that was at that moment listing rows
-- from `platform_announcements`. That claim is removed with this change.
--
-- ## Who receives one
--
-- Owners and managers with an active membership. A platform announcement
-- is addressed to the customer, not to every person on their rota — a
-- maintenance window is not something to push to 248 care workers'
-- phones. An organisation with no such account gets a delivery row marked
-- failed with a reason, rather than silence.
--
-- ## Why the delivery row carries the outbox id
--
-- Reconciliation has to be able to say which delivery a dispatch belongs
-- to. Matching on `event_name` plus a payload field would work until two
-- announcements went to one organisation in the same minute. A foreign
-- key is one column and cannot be ambiguous.
--
-- SAFETY(add column): `platform_announcement_deliveries.outbox_id` is
-- nullable and has no default, so existing rows are untouched and no row
-- is rewritten. The three functions replaced are replaced whole. The one
-- behaviour change to an existing path is that a NEW delivery is written
-- queued rather than pre-stamped as sent — which is the defect. Rows
-- written before this migration keep whatever they say; there are none in
-- production (zero announcements as of 2026-08-31).
-- =====================================================================

alter table public.platform_announcement_deliveries
  add column if not exists outbox_id uuid
    references public.notification_outbox(id) on delete set null;

comment on column public.platform_announcement_deliveries.outbox_id is
  'The dispatch this delivery is waiting on. Null for a delivery nothing was '
  'queued for — an organisation with no owner or manager to address. See 0132.';

create index if not exists announcement_deliveries_outbox_idx
  on public.platform_announcement_deliveries (outbox_id)
  where outbox_id is not null;

-- ---------------------------------------------------------------------
-- Publish: resolve the audience, queue a dispatch per organisation, and
-- leave every delivery visibly unsent until something carries it.
-- ---------------------------------------------------------------------
create or replace function public.publish_platform_announcement(p_announcement uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  a          public.platform_announcements;
  v_count    integer := 0;
  v_org      record;
  v_outbox   uuid;
  v_users    uuid[];
begin
  if not public.has_platform_role(array['platform_owner','platform_admin']) then
    raise exception 'Only a platform owner or administrator can publish an announcement'
      using errcode = '42501';
  end if;

  select * into a from public.platform_announcements where id = p_announcement;
  if not found then
    raise exception 'Announcement not found' using errcode = 'P0002';
  end if;
  if a.status = 'sent' then
    raise exception 'That announcement has already been sent' using errcode = '22023';
  end if;
  if a.status = 'cancelled' then
    raise exception 'That announcement was cancelled' using errcode = '22023';
  end if;

  for v_org in
    select o.id, o.name
      from public.organisations o
     where o.status = 'active'
       and (a.audience = 'all' or (a.audience = 'plans' and o.plan = any (a.audience_plans)))
       -- An opt-out silences product and policy mail. It does not silence a
       -- maintenance window or an incident: those are things a customer needs
       -- whether or not they asked for marketing.
       and (a.kind in ('maintenance','incident')
            or not exists (select 1 from public.platform_announcement_optouts x
                            where x.org_id = o.id))
       -- Already addressed. Re-publishing must not double-deliver, which is
       -- also what makes the scheduler safe to run twice.
       and not exists (select 1 from public.platform_announcement_deliveries d
                        where d.announcement_id = p_announcement and d.org_id = o.id)
  loop
    -- Owners and managers, not everybody. A platform announcement is
    -- addressed to the customer.
    select array_agg(distinct m.user_id)
      into v_users
      from public.memberships m
     where m.org_id = v_org.id
       and m.status = 'active'
       and m.role in ('owner', 'manager');

    v_outbox := null;

    if v_users is not null and array_length(v_users, 1) > 0 then
      insert into public.notification_outbox (org_id, event_name, payload)
      values (
        v_org.id,
        'platform/announcement',
        jsonb_build_object(
          'orgId',   v_org.id,
          'userIds', to_jsonb(v_users),
          -- The key `send-notification` maps to the `announcements` event, so
          -- an organisation's own notification settings still govern this.
          'type',    'announcement',
          'title',   a.title,
          'body',    a.body
        )
      )
      returning id into v_outbox;
    end if;

    insert into public.platform_announcement_deliveries
      (announcement_id, org_id, outbox_id, failed_at, failure_reason)
    values (
      p_announcement,
      v_org.id,
      v_outbox,
      -- Nobody to tell is a failure to record, not a silence. An
      -- organisation with no active owner or manager cannot receive this,
      -- and the console has to be able to say which ones.
      case when v_outbox is null then timezone('utc', now()) end,
      case when v_outbox is null then 'No active owner or manager to address' end
    )
    on conflict (announcement_id, org_id) do nothing;

    v_count := v_count + 1;
  end loop;

  update public.platform_announcements
     set status = 'sent', sent_at = timezone('utc', now())
   where id = p_announcement;

  perform public.audit_write(
    null, 'announcement.sent', 'platform_announcement', p_announcement,
    jsonb_build_object('title', a.title, 'before', a.status,
                       'after', v_count || ' organisations queued'),
    'notice', 'platform_only');

  return v_count;
end;
$$;

comment on function public.publish_platform_announcement(uuid) is
  'Resolves the audience into delivery rows and queues one dispatch per '
  'organisation through notification_outbox. Deliveries are written QUEUED: '
  'sent_at is stamped by reconcile_announcement_deliveries() once the dispatch '
  'is confirmed, never at insert. Re-running skips organisations already '
  'addressed, so the scheduler is safe to retry. See 0132.';

revoke all on function public.publish_platform_announcement(uuid) from public, anon;
grant execute on function public.publish_platform_announcement(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Cancel. `0025` gave the status a CHECK value and nothing that could set
-- it, so a scheduled announcement could not be stopped once written.
-- ---------------------------------------------------------------------
create or replace function public.cancel_platform_announcement(p_announcement uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a public.platform_announcements;
begin
  if not public.has_platform_role(array['platform_owner','platform_admin']) then
    raise exception 'Only a platform owner or administrator can cancel an announcement'
      using errcode = '42501';
  end if;

  select * into a from public.platform_announcements where id = p_announcement;
  if not found then
    raise exception 'Announcement not found' using errcode = 'P0002';
  end if;
  -- A sent announcement cannot be unsent. Cancelling one would produce a row
  -- claiming a message was never sent that recipients are holding.
  if a.status = 'sent' then
    raise exception 'That announcement has already been sent and cannot be cancelled'
      using errcode = '22023';
  end if;

  update public.platform_announcements
     set status = 'cancelled', scheduled_for = null
   where id = p_announcement;

  perform public.audit_write(
    null, 'announcement.cancelled', 'platform_announcement', p_announcement,
    jsonb_build_object('title', a.title, 'before', a.status, 'after', 'cancelled'),
    'notice', 'platform_only');
end;
$$;

revoke all on function public.cancel_platform_announcement(uuid) from public, anon;
grant execute on function public.cancel_platform_announcement(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Reconcile: a delivery is sent when its dispatch was, failed when the
-- dispatch was abandoned, and queued until one or the other is true.
-- ---------------------------------------------------------------------
create or replace function public.reconcile_announcement_deliveries()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_touched integer;
begin
  update public.platform_announcement_deliveries d
     set sent_at = coalesce(d.sent_at, o.dispatched_at, timezone('utc', now()))
    from public.notification_outbox o
   where o.id = d.outbox_id
     and d.sent_at is null
     and d.failed_at is null
     and o.status = 'sent';

  get diagnostics v_touched = row_count;

  update public.platform_announcement_deliveries d
     set failed_at = timezone('utc', now()),
         failure_reason = coalesce(o.last_error, 'Dispatch abandoned after repeated failures')
    from public.notification_outbox o
   where o.id = d.outbox_id
     and d.sent_at is null
     and d.failed_at is null
     and o.status = 'abandoned';

  return v_touched;
end;
$$;

comment on function public.reconcile_announcement_deliveries() is
  'Copies the outbox outcome onto the delivery. Until it runs, a delivery is '
  'queued — which is what it is. See 0132.';

revoke all on function public.reconcile_announcement_deliveries()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Publish what is due. `status = 'scheduled'` meant nothing until this.
-- ---------------------------------------------------------------------
create or replace function public.publish_due_platform_announcements()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_id      uuid;
  v_count   integer := 0;
begin
  for v_id in
    select id from public.platform_announcements
     where status = 'scheduled'
       and scheduled_for is not null
       and scheduled_for <= timezone('utc', now())
     order by scheduled_for
     -- Bounded, like the outbox drain: a cron tick should finish quickly and
     -- anything left is picked up on the next minute.
     limit 20
  loop
    begin
      -- The publish function checks the caller's platform role, which a cron
      -- job does not have. The audience resolution is inlined rather than
      -- weakening that check: a scheduled publication was authorised when a
      -- platform administrator scheduled it, and that authorisation is
      -- recorded on the row.
      perform public.publish_scheduled_announcement(v_id);
      v_count := v_count + 1;
    exception when others then
      -- One bad announcement must not stop the rest. The failure is visible
      -- in the row, which stays scheduled and is retried next minute.
      raise warning 'publish_due_platform_announcements: % failed: %', v_id, sqlerrm;
    end;
  end loop;

  perform public.reconcile_announcement_deliveries();
  return v_count;
end;
$$;

revoke all on function public.publish_due_platform_announcements()
  from public, anon, authenticated;

-- The audience resolution, without the platform-role check, callable only by
-- the scheduler. Split out rather than parameterising `publish_...` with a
-- "skip the permission check" flag, because a flag like that is one typo away
-- from being passed by a client.
create or replace function public.publish_scheduled_announcement(p_announcement uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  a        public.platform_announcements;
  v_count  integer := 0;
  v_org    record;
  v_outbox uuid;
  v_users  uuid[];
begin
  select * into a from public.platform_announcements where id = p_announcement;
  if not found then
    raise exception 'Announcement not found' using errcode = 'P0002';
  end if;
  if a.status <> 'scheduled' then
    raise exception 'Announcement % is % rather than scheduled', p_announcement, a.status
      using errcode = '22023';
  end if;

  for v_org in
    select o.id
      from public.organisations o
     where o.status = 'active'
       and (a.audience = 'all' or (a.audience = 'plans' and o.plan = any (a.audience_plans)))
       and (a.kind in ('maintenance','incident')
            or not exists (select 1 from public.platform_announcement_optouts x
                            where x.org_id = o.id))
       and not exists (select 1 from public.platform_announcement_deliveries d
                        where d.announcement_id = p_announcement and d.org_id = o.id)
  loop
    select array_agg(distinct m.user_id)
      into v_users
      from public.memberships m
     where m.org_id = v_org.id
       and m.status = 'active'
       and m.role in ('owner', 'manager');

    v_outbox := null;

    if v_users is not null and array_length(v_users, 1) > 0 then
      insert into public.notification_outbox (org_id, event_name, payload)
      values (
        v_org.id,
        'platform/announcement',
        jsonb_build_object(
          'orgId', v_org.id, 'userIds', to_jsonb(v_users),
          'type', 'announcement', 'title', a.title, 'body', a.body
        )
      )
      returning id into v_outbox;
    end if;

    insert into public.platform_announcement_deliveries
      (announcement_id, org_id, outbox_id, failed_at, failure_reason)
    values (
      p_announcement, v_org.id, v_outbox,
      case when v_outbox is null then timezone('utc', now()) end,
      case when v_outbox is null then 'No active owner or manager to address' end
    )
    on conflict (announcement_id, org_id) do nothing;

    v_count := v_count + 1;
  end loop;

  update public.platform_announcements
     set status = 'sent', sent_at = timezone('utc', now())
   where id = p_announcement;

  perform public.audit_write(
    null, 'announcement.sent', 'platform_announcement', p_announcement,
    jsonb_build_object('title', a.title, 'before', 'scheduled',
                       'after', v_count || ' organisations queued (scheduled)'),
    'notice', 'platform_only');

  return v_count;
end;
$$;

revoke all on function public.publish_scheduled_announcement(uuid)
  from public, anon, authenticated;

-- Every minute, the same tick the outbox drain uses. A scheduled
-- announcement is therefore late by at most a minute, which is the right
-- resolution for a maintenance notice and cheap when nothing is due.
select cron.unschedule('rotaflow-announcement-scheduler')
  where exists (select 1 from cron.job where jobname = 'rotaflow-announcement-scheduler');

select cron.schedule(
  'rotaflow-announcement-scheduler',
  '* * * * *',
  $cron$select public.publish_due_platform_announcements();$cron$
);

-- ---------------------------------------------------------------------
-- Delivery counts, scoped to the announcements being shown.
--
-- `listAnnouncements()` read the WHOLE deliveries table into the browser
-- and tallied it there — one row per recipient organisation per
-- announcement, which is the fastest-growing table in this feature. The
-- counts are an aggregate and belong in the database.
-- ---------------------------------------------------------------------
create or replace function public.platform_announcement_stats(p_ids uuid[])
returns table (
  announcement_id uuid,
  recipients      bigint,
  queued          bigint,
  delivered       bigint,
  failed          bigint,
  read            bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_platform_role(
       array['platform_owner','platform_admin','platform_support']) then
    raise exception 'Only platform staff can read announcement delivery counts'
      using errcode = '42501';
  end if;

  return query
    select d.announcement_id,
           count(*),
           count(*) filter (where d.sent_at is null and d.failed_at is null),
           count(*) filter (where d.sent_at is not null),
           count(*) filter (where d.failed_at is not null),
           count(*) filter (where d.read_at is not null)
      from public.platform_announcement_deliveries d
     where d.announcement_id = any (coalesce(p_ids, '{}'::uuid[]))
     group by d.announcement_id;
end;
$$;

comment on function public.platform_announcement_stats(uuid[]) is
  'Delivery counts for the announcements on screen. Queued, delivered, failed '
  'and read are four different facts and none of them is assumed from another. '
  'See 0132.';

revoke execute on function public.platform_announcement_stats(uuid[]) from public, anon;
grant execute on function public.platform_announcement_stats(uuid[]) to authenticated;
