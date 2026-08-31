-- =====================================================================
-- 0093_scheduled_alerts.sql — a missed clock-in and an expiring
-- document reach a manager without anyone opening a page
-- (docs/SAAS.md GAP-013, CAP-019, CAP-088)
--
-- Both facts are already computed correctly, and both are computed in
-- the wrong place: `findMissedClockIns` (src/lib/clockInAlerts.ts) and
-- the document-expiry block in `rotaInsights.ts` run on a dashboard
-- render. So the alert exists only while somebody is looking at the
-- screen it appears on — which means the carer who did not clock in at
-- 06:00 is noticed when a manager happens to open the dashboard, and
-- the DBS check that expired on Sunday is noticed whenever somebody
-- next visits the right page. Neither can page anyone, and nobody is
-- looking at 06:00.
--
-- This does not replace either. The screens keep their live view, which
-- is the right way to see the current state. What is added is the thing
-- that reaches out.
--
-- ## Dedupe, which is the whole difficulty
--
-- A job that runs every fifteen minutes and enqueues what it finds will
-- send the same "Ada has not clocked in" every fifteen minutes for
-- twelve hours. That is worse than no alert: it trains the recipient to
-- mute the channel, and then the one that mattered is muted too.
--
-- So `notification_outbox` gains a `dedupe_key`, unique where present,
-- and the job inserts `on conflict do nothing`. The key names the FACT,
-- not the run: one shift, or one document at one expiry date. A
-- renewed document has a new `expires_at` and therefore a new key, so
-- it can alert again when it next approaches expiry — which is correct,
-- and is the reason the key includes the date rather than just the id.
--
-- Retention (0092) prunes settled outbox rows at twelve months, so a
-- key eventually disappears. For a shift that is irrelevant: it is long
-- past. For a document it means an unrenewed one could alert again
-- after a year, which is also correct — it is still expired.
--
-- ## Who is told
--
-- Owners and managers of the organisation, not the staff member. A
-- missed clock-in needs somebody who can ring them; an expiring DBS
-- needs somebody who can book the renewal. Telling the person that they
-- have not clocked in is either useless (they know) or wrong (they are
-- on a ward with no signal). This is a supervision tool.
-- =====================================================================

alter table public.notification_outbox
  add column if not exists dedupe_key text;

comment on column public.notification_outbox.dedupe_key is
  'Names the FACT a scheduled alert is about — one shift, one document at one expiry date — so a job that runs every quarter of an hour enqueues it once. Null for event-driven notifications, which are already once-per-event.';

create unique index if not exists notification_outbox_dedupe_idx
  on public.notification_outbox (dedupe_key)
  where dedupe_key is not null;

-- ── the job ───────────────────────────────────────────────────────────
create or replace function public.enqueue_scheduled_alerts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before integer;
  v_after  integer;
begin
  select count(*) into v_before from public.notification_outbox;

  -- ---- missed clock-ins ---------------------------------------------
  --
  -- The same thresholds as `findMissedClockIns` — 30 minutes late, and a
  -- 12-hour ceiling because a shift from yesterday that was never worked is
  -- a timesheet problem rather than something to alert on. Drifting from the
  -- client rule would mean the dashboard and the notification disagree about
  -- what counts, which is worse than either rule alone.
  --
  -- One deliberate difference: the clock-event lookup is WINDOWED to the
  -- shift, where the client checks whether the person has any 'in' event in
  -- the set it happens to have loaded. The client's version is a consequence
  -- of what it fetched, not a rule anybody chose; here the whole history is
  -- visible, and "did they clock in for THIS shift" is the question actually
  -- being asked. Two hours before the start covers an early arrival.
  insert into public.notification_outbox (org_id, event_name, payload, dedupe_key)
  select s.org_id,
         'alert/missed_clock_in',
         jsonb_build_object(
           'orgId', s.org_id,
           'userIds', to_jsonb(mgr.user_ids),
           'type', 'attendance',
           'title', sp.first_name || ' ' || sp.last_name || ' has not clocked in',
           'body', 'Their shift started at ' ||
                   to_char(s.starts_at at time zone coalesce(l.timezone, 'Europe/London'), 'HH24:MI') ||
                   '. Nothing has been recorded since.'
         ),
         'missed_clock_in:' || s.id
    from public.shifts s
    join public.staff_profiles sp on sp.id = s.staff_profile_id
    left join public.locations l on l.id = s.location_id
    cross join lateral (
      select array_agg(m.user_id) as user_ids
        from public.memberships m
       where m.org_id = s.org_id
         and m.status = 'active'
         and m.role in ('owner', 'manager')
    ) mgr
   where s.staff_profile_id is not null
     and s.status <> 'cancelled'
     and s.starts_at < timezone('utc', now()) - interval '30 minutes'
     and s.starts_at > timezone('utc', now()) - interval '12 hours'
     and mgr.user_ids is not null
     and not exists (
       select 1 from public.clock_events c
        where c.staff_profile_id = s.staff_profile_id
          and c.type = 'in'
          and c.event_at between s.starts_at - interval '2 hours'
                             and timezone('utc', now())
     )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  -- ---- expiring documents -------------------------------------------
  --
  -- Thirty days, and separately the ones already expired. Two buckets in
  -- the key, so a document alerts once as "expiring" and once again after
  -- it lapses — the second is a different fact and a manager who missed
  -- the first needs it.
  insert into public.notification_outbox (org_id, event_name, payload, dedupe_key)
  select d.org_id,
         'alert/document_expiry',
         jsonb_build_object(
           'orgId', d.org_id,
           'userIds', to_jsonb(mgr.user_ids),
           'type', 'document',
           'title', case when d.expires_at < current_date
                         then d.name || ' has expired for ' || sp.first_name || ' ' || sp.last_name
                         else d.name || ' expires soon for ' || sp.first_name || ' ' || sp.last_name end,
           'body', case when d.expires_at < current_date
                        then 'Expired on ' || to_char(d.expires_at, 'FMDD FMMonth YYYY') ||
                             ', and they are still on the rota. Check whether they are eligible to work.'
                        else 'Expires on ' || to_char(d.expires_at, 'FMDD FMMonth YYYY') ||
                             '. Book the renewal before it blocks a shift.' end
         ),
         'document_expiry:' || d.id || ':' || d.expires_at || ':' ||
           case when d.expires_at < current_date then 'expired' else 'soon' end
    from public.documents d
    join public.staff_profiles sp on sp.id = d.staff_profile_id
    cross join lateral (
      select array_agg(m.user_id) as user_ids
        from public.memberships m
       where m.org_id = d.org_id
         and m.status = 'active'
         and m.role in ('owner', 'manager')
    ) mgr
   where d.expires_at is not null
     and d.expires_at <= current_date + 30
     -- A document that lapsed a year ago is history, not news. Without this
     -- the first run would enqueue every expired document ever recorded.
     and d.expires_at >= current_date - 30
     and sp.active
     and mgr.user_ids is not null
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  select count(*) into v_after from public.notification_outbox;
  return v_after - v_before;
end;
$$;

comment on function public.enqueue_scheduled_alerts() is
  'Finds missed clock-ins and expiring documents and enqueues one notification per fact, deduped by dedupe_key. Runs on a schedule so an alert does not depend on somebody having a dashboard open.';

revoke all on function public.enqueue_scheduled_alerts() from public, anon, authenticated;

-- Every fifteen minutes. The dedupe key is what makes the frequency safe:
-- a run that finds the same missed clock-in as the last one enqueues
-- nothing. Fifteen minutes is chosen against the 30-minute threshold above,
-- so the worst case between a shift being missed and somebody being told is
-- about three quarters of an hour.
select cron.schedule(
  'rotaflow-scheduled-alerts',
  '*/15 * * * *',
  $$select public.enqueue_scheduled_alerts();$$
);
