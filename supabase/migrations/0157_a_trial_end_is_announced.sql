-- =====================================================================
-- 0157_a_trial_end_is_announced.sql: an owner hears that the free trial
-- is ending before it ends (docs/SAAS.md GAP-127, CAP-125)
--
-- ## What was missing
--
-- Every organisation starts with a 30-day trial held on the organisation
-- (`organisations.trial_ends_at`, 0154). When it passes without a plan,
-- the organisation becomes read-only. Nothing told the owner it was
-- coming: the countdown on Settings, Billing is seen only by someone who
-- opens that page, and the read-only banner appears after the fact.
-- Stripe's own `customer.subscription.trial_will_end` covers a STRIPE
-- trial only, which exists once an owner has been through Checkout, so
-- the trial almost every organisation is actually on had no reminder.
--
-- ## What this adds
--
-- One more fact in `enqueue_scheduled_alerts` (0093), which already runs
-- every fifteen minutes and already dedupes on the fact rather than the
-- run. An organisation whose own trial ends within three days, whose
-- billing state is still `trial` (no active, trialing or in-grace Stripe
-- subscription, so an owner who has already chosen a plan is not
-- chased), and which is `active` (a suspended or archived organisation is
-- not sold to) queues one `billing/trial_ending` notice to its active
-- owners.
--
-- Three days matches Stripe's `trial_will_end`, so the two reminders read
-- alike. The dedupe key names the organisation AND the trial end, so a
-- trial the platform extends gets a fresh reminder before its new end,
-- which is correct: it is a new fact.
--
-- The notice is `type: 'billing'`, so `send-notification` delivers it in
-- the app and by email under the owner's own channel preferences, the
-- same path as "Your trial ends in 3 days" and "Payment failed".
--
-- The rest of the function body is 0093's, unchanged. `create or
-- replace` keeps the function's grants (0093 revoked it from
-- `authenticated`; 0113 recorded the rest), so no grant is added or
-- removed, and the revoke below only restates 0093's. The cron job is the
-- same job: nothing is scheduled here.
--
-- pgTAP: supabase/tests/database/trial_end_reminder.test.sql.
-- =====================================================================

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
  -- The same thresholds as `findMissedClockIns`: 30 minutes late, and a
  -- 12-hour ceiling because a shift from yesterday that was never worked
  -- is a timesheet problem rather than something to alert on. Unchanged
  -- from 0093, which explains the windowed clock-event lookup.
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
  -- Unchanged from 0093: thirty days ahead, and separately the ones
  -- already expired, two buckets in the key.
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
     and d.expires_at >= current_date - 30
     and sp.active
     and mgr.user_ids is not null
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  -- ---- a free trial about to end (0157) -----------------------------
  --
  -- The organisation's own trial, not a Stripe one: `org_billing_state`
  -- returns 'trial' only while no active, trialing or in-grace
  -- subscription exists, so an owner who has chosen a plan hears nothing.
  -- Owners only, because choosing a plan is theirs to do.
  insert into public.notification_outbox (org_id, event_name, payload, dedupe_key)
  select o.id,
         'billing/trial_ending',
         jsonb_build_object(
           'orgId', o.id,
           'userIds', to_jsonb(own.user_ids),
           'type', 'billing',
           'title', 'Your free trial ends on ' ||
                    to_char(o.trial_ends_at at time zone 'Europe/London', 'FMDD FMMonth'),
           'body', 'After that, managers cannot build rotas or invite people until a plan ' ||
                   'is chosen. Your rotas and records stay as they are. Choose a plan in ' ||
                   'Settings, Billing.'
         ),
         'trial_ending:' || o.id || ':' || o.trial_ends_at
    from public.organisations o
    cross join lateral (
      select array_agg(m.user_id) as user_ids
        from public.memberships m
       where m.org_id = o.id
         and m.status = 'active'
         and m.role = 'owner'
    ) own
   where o.trial_ends_at is not null
     and o.trial_ends_at > timezone('utc', now())
     and o.trial_ends_at <= timezone('utc', now()) + interval '3 days'
     and o.status = 'active'
     and public.org_billing_state(o.id) = 'trial'
     and own.user_ids is not null
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  select count(*) into v_after from public.notification_outbox;
  return v_after - v_before;
end;
$$;

comment on function public.enqueue_scheduled_alerts() is
  'Finds missed clock-ins, expiring documents and free trials ending within three days, and enqueues one notification per fact, deduped by dedupe_key. Runs on a schedule so an alert does not depend on somebody having a dashboard open. The trial reminder was added by 0157.';

revoke all on function public.enqueue_scheduled_alerts() from public, anon, authenticated;
