-- =====================================================================
-- 0087_server_side_dispatch.sql — leave decisions, swap decisions and
-- announcements are enqueued by the database, not by the browser
-- (docs/SAAS.md GAP-026, CAP-034)
--
-- 0069 gave rota publication a durable path: `publish_rota` writes the
-- notification into `notification_outbox` in the SAME transaction as the
-- publish, and a pg_cron drain posts it. Nothing can lose it, because
-- the row that owes the notification and the notification itself commit
-- together or not at all.
--
-- The other four dispatches never moved. They are `void send(...)` calls
-- in `LeavePage`, `SwapsPage` and `AnnouncementsPage`, fired from the
-- browser AFTER the write succeeded:
--
--     await reviewLeaveRequest(...);   -- committed
--     showSuccess('Approved.');        -- user sees it
--     void send('leave/reviewed', …);  -- may never happen
--
-- Close the tab, lose the network at the wrong moment, or navigate on the
-- success toast, and the decision is recorded while the person it was
-- about is never told. BUG-047 softened this by queueing a failed post in
-- the IndexedDB outbox, which helps only if the tab lives long enough to
-- write to IndexedDB and later comes back online. A shift manager
-- approving leave on a phone and locking it is the ordinary case, not the
-- edge case.
--
-- ## Triggers, because the state change IS the event
--
-- Each of these notifications is owed precisely when a row changes:
--
--   leave_requests   status pending -> approved/rejected
--   shift_swaps      status pending/accepted -> approved/rejected
--   announcements    published_at becomes non-null
--
-- A trigger on that transition cannot disagree with the data, cannot be
-- skipped by a caller who forgot, and commits with the change it
-- describes. The three client dispatches are removed in the same change.
--
-- ## The audience is computed here now, and that is a fix in itself
--
-- `AnnouncementsPage` resolved the audience in the browser from whatever
-- staff list it had loaded — so an announcement's reach depended on a
-- client-side cache. `announcement_audience()` derives it from the
-- announcement's own `department_id` / `location_id`, which is the same
-- rule expressed once, server-side, where the reminder path can share it.
--
-- ## Deliberately unchanged
--
-- * A swap reaching 'accepted' (the colleague agreeing, before a manager
--   decides) still notifies nobody. It notified nobody before either.
--   Adding it is a product decision, not part of moving dispatch, and it
--   belongs in its own change.
-- * Withdrawals and take-downs stay silent, as they were.
--
-- ## One wording change, on purpose
--
-- The stored status is 'rejected'; leave already told the person their
-- request was "declined" while swaps said "rejected". Both now say
-- declined. Telling somebody their request was rejected is a harsher
-- sentence than the product means, and two different words for one
-- decision was an accident of two pages, not a distinction.
-- =====================================================================

-- ── who an announcement is for ────────────────────────────────────────
--
-- Department wins over location when both are set, which is what the page
-- did: the narrower audience is the one the author chose last.
--
-- Only ACTIVE staff with a linked account: a leaver keeps their profile
-- for the audit trail, and a profile with no `user_id` has nobody to
-- notify.
create or replace function public.announcement_audience(p_announcement_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select sp.user_id
    from public.announcements a
    join public.staff_profiles sp on sp.org_id = a.org_id
    left join public.departments d on d.id = sp.department_id
   where a.id = p_announcement_id
     and sp.active
     and sp.user_id is not null
     and (
       case
         when a.department_id is not null then sp.department_id = a.department_id
         when a.location_id   is not null then d.location_id     = a.location_id
         else true
       end
     );
$$;

comment on function public.announcement_audience(uuid) is
  'The user ids an announcement is addressed to, from its own department/location scope. One definition shared by the publish trigger and the unread reminder.';

revoke all on function public.announcement_audience(uuid) from public, anon;

-- ── leave decisions ───────────────────────────────────────────────────
create or replace function public.enqueue_leave_reviewed_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_range   text;
  v_verb    text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('approved', 'rejected') then
    return new;
  end if;

  select sp.user_id into v_user_id
    from public.staff_profiles sp
   where sp.id = new.staff_profile_id;

  -- Nobody to tell: an unlinked profile, or a manager approving their own
  -- request, who watched themselves do it.
  if v_user_id is null or v_user_id = new.reviewed_by then
    return new;
  end if;

  -- "3-7 March 2027" / "3 March 2027", matching `formatLeaveRange` in
  -- src/lib/leaveRows.ts. FM strips the padding to_char would otherwise
  -- leave, so it reads "3 March" and not "3 March".
  v_range := case
    when new.start_date = new.end_date
      then to_char(new.start_date, 'FMDD FMMonth YYYY')
    when date_trunc('month', new.start_date) = date_trunc('month', new.end_date)
      then to_char(new.start_date, 'FMDD') || '-' || to_char(new.end_date, 'FMDD FMMonth YYYY')
    when date_part('year', new.start_date) = date_part('year', new.end_date)
      then to_char(new.start_date, 'FMDD FMMonth') || '-' || to_char(new.end_date, 'FMDD FMMonth YYYY')
    else to_char(new.start_date, 'FMDD FMMonth YYYY') || '-' || to_char(new.end_date, 'FMDD FMMonth YYYY')
  end;

  v_verb := case when new.status = 'approved' then 'approved' else 'declined' end;

  insert into public.notification_outbox (org_id, event_name, payload)
  values (
    new.org_id,
    'leave/reviewed',
    jsonb_build_object(
      'orgId',   new.org_id,
      'userIds', jsonb_build_array(v_user_id),
      'type',    'leave',
      'title',   'Your leave request was ' || v_verb,
      'body',    v_range
    )
  );

  return new;
end;
$$;

drop trigger if exists leave_requests_enqueue_reviewed on public.leave_requests;
create trigger leave_requests_enqueue_reviewed
  after update on public.leave_requests
  for each row execute function public.enqueue_leave_reviewed_notification();

-- ── swap decisions ────────────────────────────────────────────────────
create or replace function public.enqueue_swap_reviewed_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_verb    text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('approved', 'rejected') then
    return new;
  end if;

  select sp.user_id into v_user_id
    from public.staff_profiles sp
   where sp.id = new.requested_by;

  if v_user_id is null or v_user_id = new.reviewed_by then
    return new;
  end if;

  v_verb := case when new.status = 'approved' then 'approved' else 'declined' end;

  insert into public.notification_outbox (org_id, event_name, payload)
  values (
    new.org_id,
    'swap/reviewed',
    jsonb_build_object(
      'orgId',   new.org_id,
      'userIds', jsonb_build_array(v_user_id),
      'type',    'swap',
      'title',   'Your shift swap was ' || v_verb
    )
  );

  return new;
end;
$$;

drop trigger if exists shift_swaps_enqueue_reviewed on public.shift_swaps;
create trigger shift_swaps_enqueue_reviewed
  after update on public.shift_swaps
  for each row execute function public.enqueue_swap_reviewed_notification();

-- ── announcements ─────────────────────────────────────────────────────
--
-- Fires on publication, whether that is the insert (which is how the app
-- posts one) or a later edit that sets `published_at`. A draft saved and
-- published afterwards therefore notifies once, at publication, and an
-- edit to an already-published announcement notifies nobody — re-paging a
-- whole department because somebody fixed a typo is the noise 0083 went
-- to some trouble to avoid.
create or replace function public.enqueue_announcement_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_ids uuid[];
begin
  if new.published_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.published_at is not null then
    return new;
  end if;

  select array_agg(a.user_id)
    into v_user_ids
    from public.announcement_audience(new.id) a;

  -- An audience of nobody: an empty department, or an org whose staff have
  -- no accounts yet. Enqueuing an empty recipient list would make the
  -- drain post a notification to no one and record it as sent.
  if v_user_ids is null or array_length(v_user_ids, 1) is null then
    return new;
  end if;

  insert into public.notification_outbox (org_id, event_name, payload)
  values (
    new.org_id,
    'announcement/published',
    jsonb_build_object(
      'orgId',   new.org_id,
      'userIds', to_jsonb(v_user_ids),
      'type',    'announcement',
      'title',   new.title,
      'body',    new.body
    )
  );

  return new;
end;
$$;

drop trigger if exists announcements_enqueue_published on public.announcements;
create trigger announcements_enqueue_published
  after insert or update of published_at on public.announcements
  for each row execute function public.enqueue_announcement_notification();

-- ── reminding whoever has not read it ─────────────────────────────────
--
-- The one dispatch a trigger cannot carry: no row changes when a manager
-- presses "Remind unread", so there is no transition to hang it on. It
-- becomes an RPC instead, which is still the fix that matters — the
-- outbox row is committed before the call returns, so the reminder
-- survives the tab closing the instant afterwards.
--
-- Returns the number of people it will reach, so the page can say so
-- honestly rather than asserting a count it computed from a stale list.
create or replace function public.remind_announcement_unread(p_announcement_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id   uuid;
  v_title    text;
  v_body     text;
  v_user_ids uuid[];
begin
  select a.org_id, a.title, a.body
    into v_org_id, v_title, v_body
    from public.announcements a
   where a.id = p_announcement_id;

  if v_org_id is null then
    raise exception 'Announcement not found' using errcode = 'ANN01';
  end if;

  -- SECURITY DEFINER, so the membership check is this function's job. A
  -- reminder is a broadcast to other people's phones; only the roles that
  -- may post an announcement may re-send one.
  if not public.has_org_role(v_org_id, array['owner', 'manager']) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  select array_agg(aud.user_id)
    into v_user_ids
    from public.announcement_audience(p_announcement_id) aud
   where not exists (
     select 1
       from public.announcement_reads r
       join public.staff_profiles sp on sp.id = r.staff_profile_id
      where r.announcement_id = p_announcement_id
        and sp.user_id = aud.user_id
   );

  if v_user_ids is null or array_length(v_user_ids, 1) is null then
    return 0;
  end if;

  insert into public.notification_outbox (org_id, event_name, payload)
  values (
    v_org_id,
    'announcement/published',
    jsonb_build_object(
      'orgId',   v_org_id,
      'userIds', to_jsonb(v_user_ids),
      'type',    'announcement',
      'title',   v_title,
      'body',    v_body
    )
  );

  return array_length(v_user_ids, 1);
end;
$$;

comment on function public.remind_announcement_unread(uuid) is
  'Enqueue one reminder to everyone in an announcement''s audience who has not read it. Returns the recipient count. Owner/manager only.';

revoke all on function public.remind_announcement_unread(uuid) from public, anon;
grant execute on function public.remind_announcement_unread(uuid) to authenticated;
