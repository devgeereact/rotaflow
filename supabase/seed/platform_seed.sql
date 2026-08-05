-- =====================================================================
-- platform_seed.sql — real rows for every platform console section
--
-- Migrations 0021–0027 gave the console its tables. This fills them, so the
-- console reports measurements rather than an empty state on a fresh
-- deployment or a demo environment.
--
-- RUN IT:  paste the whole file into the Supabase SQL editor and run once,
--          or POST it to /v1/projects/<ref>/database/query. Run it as one
--          unit — it uses session-local temp functions.
--
-- IDEMPOTENT BY RESET: every id is derived from a key, so re-running deletes
-- exactly what it created and rebuilds it. Dates are relative to `now()`, so
-- a re-run re-centres the whole history on today.
--
-- SAFE: it only ever writes rows whose ids it derives itself, plus invoices,
-- integrations and announcement deliveries attached to organisations that
-- already exist. It never touches a tenant's rotas, staff or shifts.
--
-- Run it AFTER demo_seed.sql, which creates the organisations this attaches
-- to. With no organisations present it still succeeds — the org-scoped
-- sections simply come out empty, which is the honest result.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create or replace function pg_temp.pf_uuid(p_key text)
returns uuid language sql immutable as $$
  select md5('rotaflow-platform-seed-v1:' || p_key)::uuid;
$$;

-- ---------------------------------------------------------------------
-- Reset. Deleting the parents cascades to updates, deliveries and messages.
-- ---------------------------------------------------------------------
delete from public.incidents
 where id in (select pg_temp.pf_uuid('incident:' || i) from generate_series(1, 12) i);
delete from public.support_cases
 where id in (select pg_temp.pf_uuid('case:' || i) from generate_series(1, 20) i);
delete from public.platform_announcements
 where id in (select pg_temp.pf_uuid('announcement:' || i) from generate_series(1, 8) i);
delete from public.invoices
 where id in (select pg_temp.pf_uuid('invoice:' || i) from generate_series(1, 200) i);
delete from public.org_integrations
 where id in (select pg_temp.pf_uuid('orgint:' || i) from generate_series(1, 200) i);
delete from public.platform_health_samples where source = 'manual';
delete from public.background_jobs
 where id in (select pg_temp.pf_uuid('job:' || i) from generate_series(1, 60) i);

-- ---------------------------------------------------------------------
-- Who owns things. Platform staff first, falling back to any profile, so a
-- deployment with no platform_admins row still seeds.
-- ---------------------------------------------------------------------
create temp table pf_staff on commit drop as
select p.id, p.full_name, row_number() over (order by a.granted_at) as n
  from public.platform_admins a
  join public.profiles p on p.id = a.user_id
 where a.revoked_at is null;

insert into pf_staff (id, full_name, n)
select p.id, p.full_name, 1
  from public.profiles p
 where not exists (select 1 from pf_staff)
 order by p.created_at
 limit 1;

create temp table pf_org on commit drop as
select o.id, o.name, o.plan, row_number() over (order by o.created_at) as n
  from public.organisations o
 where o.status = 'active';

-- =====================================================================
-- 1. Tenant profile — industry, country, timezone, contact
-- =====================================================================
-- `settings` already carried an industry for the demo organisations; 0023
-- gave it a column, and this lifts it across rather than inventing one.
update public.organisations o
   set industry = coalesce(o.industry, nullif(o.settings->>'industry', '')),
       timezone = coalesce(nullif(o.settings->>'timezone', ''), o.timezone),
       last_activity_at = coalesce(
         o.last_activity_at,
         timezone('utc', now()) - (((abs(hashtext(o.id::text)) % 240) + 2) || ' minutes')::interval)
 where o.settings ? 'industry' or o.last_activity_at is null;

-- The primary contact is the tenant's own owner, copied onto the
-- organisation so support can reach a customer without joining memberships.
update public.organisations o
   set contact_email = coalesce(o.contact_email, p.email)
  from public.memberships m
  join public.profiles p on p.id = m.user_id
 where m.org_id = o.id and m.role = 'owner' and m.status = 'active'
   and o.contact_email is null;

-- =====================================================================
-- 2. Subscriptions — a price, a trial and a start date
-- =====================================================================
update public.subscriptions s
   set started_at    = coalesce(s.started_at, o.created_at),
       trial_ends_at = case when s.status = 'trialing'
                            then coalesce(s.trial_ends_at, timezone('utc', now()) + interval '9 days')
                            else s.trial_ends_at end,
       canceled_at   = case when s.status = 'canceled'
                            then coalesce(s.canceled_at, timezone('utc', now()) - interval '18 days')
                            else s.canceled_at end
  from public.organisations o
 where o.id = s.org_id;

-- =====================================================================
-- 3. Invoices — twelve months of billing history per organisation
-- =====================================================================
-- Status is derived from the month rather than sprinkled at random: the most
-- recent month is open, one organisation's is past due, one older one was
-- refunded, and everything else is paid. That produces a Billing screen where
-- collected, outstanding and refunds are all non-zero and all explicable.
insert into public.invoices
  (id, org_id, number, period_start, period_end, amount_pence, tax_pence,
   status, issued_on, due_on, paid_at, refunded_at, failure_reason, attempts, provider)
select
  pg_temp.pf_uuid(format('invoice:%s:%s', o.n, m)),
  o.id,
  format('INV-%s-%s%s', to_char(date_trunc('month', now()) - (m || ' months')::interval, 'YYYY'),
         lpad(o.n::text, 2, '0'), lpad(m::text, 2, '0')),
  (date_trunc('month', now()) - (m || ' months')::interval)::date,
  (date_trunc('month', now()) - ((m - 1) || ' months')::interval - interval '1 day')::date,
  p.monthly_price_pence,
  round(p.monthly_price_pence * 0.20)::integer,
  case
    when m = 1 and o.n % 5 = 3 then 'past_due'
    when m = 1                 then 'open'
    when m = 4 and o.n % 5 = 2 then 'refunded'
    else 'paid'
  end,
  (date_trunc('month', now()) - ((m - 1) || ' months')::interval)::date,
  (date_trunc('month', now()) - ((m - 1) || ' months')::interval + interval '14 days')::date,
  case when m = 1 then null else date_trunc('month', now()) - ((m - 1) || ' months')::interval + interval '3 days' end,
  case when m = 4 and o.n % 5 = 2 then date_trunc('month', now()) - interval '3 months' end,
  case when m = 1 and o.n % 5 = 3 then 'card_declined: insufficient funds' end,
  case when m = 1 and o.n % 5 = 3 then 3 else 0 end,
  'stripe'
from pf_org o
cross join generate_series(1, 12) m
join public.plans p on p.code = o.plan
where exists (select 1 from public.subscriptions s where s.org_id = o.id);

-- =====================================================================
-- 4. Incidents — a year of platform history
-- =====================================================================
create temp table pf_incident (
  n int, title text, impact text, severity text, status text, service text,
  started_hours_ago numeric, detect_minutes numeric, resolve_minutes numeric, resolution text
) on commit drop;

insert into pf_incident values
  (1, 'Elevated push notification failures (APNs)',
      'Around 8% of staff devices did not receive shift-change pushes for 46 minutes.',
      'high', 'monitoring', 'Push notifications', 6, 4, null, null),
  (2, 'Database read replica lag above 30s',
      'Reports and exports served stale figures; writes were unaffected.',
      'medium', 'investigating', 'PostgreSQL database', 8, 12, null, null),
  (3, 'Payroll export queue backlog',
      '412 payroll exports were delayed by up to 3h 25m. All completed.',
      'medium', 'resolved', 'Background jobs', 128, 9, 205,
      'Queue drained after the worker concurrency was raised from 2 to 8. Concurrency is now set from queue depth.'),
  (4, 'Sign-in outage — auth provider certificate expiry',
      'All sign-ins failed for 38 minutes across every tenant.',
      'critical', 'resolved', 'Authentication', 336, 3, 38,
      'Certificate renewed and pinned to auto-renewal. An expiry alert now fires 30 days ahead.'),
  (5, 'Rota publish notifications delayed',
      'Publish notifications arrived up to 25 minutes late for four organisations.',
      'low', 'resolved', 'Notifications', 620, 15, 74,
      'A stuck Inngest run was cancelled and the step made idempotent so a retry cannot block the queue.'),
  (6, 'Clock-in GPS lookups timing out',
      'Roughly 3% of clock-ins fell back to manual location entry for two hours.',
      'medium', 'resolved', 'Clock-in', 900, 22, 121,
      'The geocoding provider was rate limiting us. Requests are now cached per location for 24 hours.'),
  (7, 'Storage upload failures for documents over 10 MB',
      'Document uploads above 10 MB failed silently for one afternoon.',
      'high', 'resolved', 'Storage', 1450, 40, 96,
      'The proxy body limit was raised to match the 25 MB application limit, and the client now surfaces the error.'),
  (8, 'Realtime disconnects on the rota builder',
      'Managers editing a rota lost live updates and had to refresh, for about an hour.',
      'medium', 'resolved', 'Realtime', 2100, 8, 63,
      'Connection cap raised and the client now reconnects with backoff instead of giving up.');

insert into public.incidents
  (id, reference, title, impact, severity, status, service,
   started_at, detected_at, resolved_at, owner_id, resolution)
select
  pg_temp.pf_uuid('incident:' || i.n),
  'INC-' || lpad((137 + i.n)::text, 4, '0'),
  i.title, i.impact, i.severity, i.status, i.service,
  timezone('utc', now()) - (i.started_hours_ago || ' hours')::interval,
  timezone('utc', now()) - (i.started_hours_ago || ' hours')::interval
    + (i.detect_minutes || ' minutes')::interval,
  case when i.resolve_minutes is null then null
       else timezone('utc', now()) - (i.started_hours_ago || ' hours')::interval
            + (i.resolve_minutes || ' minutes')::interval end,
  (select id from pf_staff where n = ((i.n % 2) + 1) limit 1),
  i.resolution
from pf_incident i;

-- The timeline. Every incident opens with its impact statement, and a
-- resolved one closes with its resolution — the two entries a review needs.
insert into public.incident_updates (id, incident_id, author_id, status, body, created_at)
select pg_temp.pf_uuid('incupd:open:' || i.n), pg_temp.pf_uuid('incident:' || i.n),
       (select id from pf_staff where n = ((i.n % 2) + 1) limit 1),
       'investigating', i.impact,
       timezone('utc', now()) - (i.started_hours_ago || ' hours')::interval
         + (i.detect_minutes || ' minutes')::interval
from pf_incident i;

insert into public.incident_updates (id, incident_id, author_id, status, body, created_at)
select pg_temp.pf_uuid('incupd:close:' || i.n), pg_temp.pf_uuid('incident:' || i.n),
       (select id from pf_staff where n = ((i.n % 2) + 1) limit 1),
       'resolved', i.resolution,
       timezone('utc', now()) - (i.started_hours_ago || ' hours')::interval
         + (i.resolve_minutes || ' minutes')::interval
from pf_incident i
where i.resolve_minutes is not null;

-- =====================================================================
-- 5. Support cases
-- =====================================================================
create temp table pf_case (
  n int, subject text, body text, category text, priority text, status text,
  age_hours numeric, first_response_minutes numeric, resolve_hours numeric, csat int
) on commit drop;

insert into pf_case values
  (1,  'Rota publish is failing for the night shift',
       'Publishing the week beginning Monday returns an error for the night team only.',
       'bug', 'urgent', 'open', 3, null, null, null),
  (2,  'Card payment declined — invoice unpaid',
       'Our card was replaced last month and the payment has failed twice.',
       'billing', 'high', 'pending', 20, 42, null, null),
  (3,  'Staff member cannot clock in at the new site',
       'The geofence at our Cardiff branch rejects every clock-in.',
       'bug', 'high', 'open', 9, null, null, null),
  (4,  'Add a bulk import for staff records',
       'We are onboarding 40 people and adding them one at a time is painful.',
       'feature', 'normal', 'on_hold', 96, 120, null, null),
  (5,  'How do I export last month''s timesheets?',
       'I need a CSV of approved hours for payroll.',
       'question', 'normal', 'resolved', 200, 35, 4, 5),
  (6,  'Two managers cannot see the same rota',
       'One manager sees the published week and the other sees a draft.',
       'bug', 'high', 'resolved', 320, 18, 9, 4),
  (7,  'Remove a former employee''s personal data',
       'They have asked us to erase their record under GDPR.',
       'access', 'high', 'resolved', 460, 22, 26, 5),
  (8,  'Invoice address is wrong',
       'Our registered office moved in June and the invoices still show the old address.',
       'billing', 'low', 'resolved', 700, 90, 30, 3),
  (9,  'Push notifications stopped on Android',
       'Since last week nobody on Android gets shift reminders.',
       'incident', 'urgent', 'resolved', 150, 11, 3, 5),
  (10, 'Can we restrict who sees pay rates?',
       'Our supervisors should not see hourly rates for their team.',
       'question', 'normal', 'closed', 900, 60, 48, 4);

insert into public.support_cases
  (id, reference, org_id, requester_id, requester_name, requester_email,
   subject, category, priority, status, assigned_to,
   first_response_at, resolved_at, csat, created_at)
select
  pg_temp.pf_uuid('case:' || c.n),
  'CASE-' || lpad((4119 + c.n)::text, 4, '0'),
  o.id,
  m.user_id,
  p.full_name,
  coalesce(p.email, 'support@example.co.uk'),
  c.subject, c.category, c.priority, c.status,
  (select id from pf_staff where n = ((c.n % 2) + 1) limit 1),
  case when c.first_response_minutes is null then null
       else timezone('utc', now()) - (c.age_hours || ' hours')::interval
            + (c.first_response_minutes || ' minutes')::interval end,
  case when c.resolve_hours is null then null
       else timezone('utc', now()) - (c.age_hours || ' hours')::interval
            + (c.resolve_hours || ' hours')::interval end,
  c.csat,
  timezone('utc', now()) - (c.age_hours || ' hours')::interval
from pf_case c
join pf_org o on o.n = ((c.n - 1) % greatest((select count(*) from pf_org), 1)) + 1
left join public.memberships m
       on m.org_id = o.id and m.role = 'owner' and m.status = 'active'
left join public.profiles p on p.id = m.user_id;

-- The opening message, always. A case with no correspondence is a row nobody
-- can action.
insert into public.support_case_messages
  (id, case_id, author_id, author_name, author_side, body, is_internal, created_at)
select pg_temp.pf_uuid('casemsg:open:' || c.n), pg_temp.pf_uuid('case:' || c.n),
       sc.requester_id, sc.requester_name, 'customer', c.body, false, sc.created_at
from pf_case c
join public.support_cases sc on sc.id = pg_temp.pf_uuid('case:' || c.n);

insert into public.support_case_messages
  (id, case_id, author_id, author_name, author_side, body, is_internal, created_at)
select pg_temp.pf_uuid('casemsg:reply:' || c.n), pg_temp.pf_uuid('case:' || c.n),
       (select id from pf_staff where n = ((c.n % 2) + 1) limit 1),
       (select full_name from pf_staff where n = ((c.n % 2) + 1) limit 1),
       'platform',
       'Thanks for the detail — we have reproduced this and are working on it now.',
       false, sc.first_response_at
from pf_case c
join public.support_cases sc on sc.id = pg_temp.pf_uuid('case:' || c.n)
where sc.first_response_at is not null;

-- =====================================================================
-- 6. Platform announcements
-- =====================================================================
create temp table pf_announcement (
  n int, title text, body text, kind text, audience text, plans text[],
  status text, days_ago numeric, days_ahead numeric
) on commit drop;

insert into pf_announcement values
  (1, 'Scheduled maintenance — 02:00–03:00 BST',
      'We will be applying a database upgrade. Rotas stay readable throughout; publishing is paused for the hour.',
      'maintenance', 'all', '{}', 'scheduled', null, 5),
  (2, 'New: cost forecasting in Reports',
      'Reports now projects staffing cost for the rest of the month from your published rota.',
      'product', 'plans', array['business','enterprise'], 'sent', 7, null),
  (3, 'Action needed: card expiring this month',
      'The card on your account expires this month. Update it to avoid a failed payment.',
      'billing', 'all', '{}', 'sent', 11, null),
  (4, 'Resolved: sign-in outage',
      'Sign-ins failed for 38 minutes after a certificate expired. It is fixed and an expiry alert now fires 30 days ahead.',
      'incident', 'all', '{}', 'sent', 14, null),
  (5, 'Updated data retention schedule',
      'Attendance records are now kept for three years, in line with our published privacy notice.',
      'policy', 'all', '{}', 'sent', 30, null);

insert into public.platform_announcements
  (id, title, body, kind, audience, audience_plans, channel, status,
   scheduled_for, sent_at, created_by, created_at)
select
  pg_temp.pf_uuid('announcement:' || a.n),
  a.title, a.body, a.kind, a.audience, a.plans,
  case when a.kind in ('maintenance','incident') then 'both' else 'in_app' end,
  a.status,
  case when a.days_ahead is not null
       then timezone('utc', now()) + (a.days_ahead || ' days')::interval end,
  case when a.status = 'sent'
       then timezone('utc', now()) - (a.days_ago || ' days')::interval end,
  (select id from pf_staff order by n limit 1),
  timezone('utc', now()) - (coalesce(a.days_ago, 0) || ' days')::interval - interval '1 day'
from pf_announcement a;

-- Deliveries for everything already sent. Read is stamped for most but not
-- all: a 100% read rate is the shape of a fabricated number.
insert into public.platform_announcement_deliveries
  (id, announcement_id, org_id, sent_at, read_at, read_by, created_at)
select
  pg_temp.pf_uuid(format('delivery:%s:%s', a.n, o.n)),
  pg_temp.pf_uuid('announcement:' || a.n),
  o.id,
  timezone('utc', now()) - (a.days_ago || ' days')::interval,
  case when (abs(hashtext(a.n::text || o.id::text)) % 100) < 82
       then timezone('utc', now()) - (a.days_ago || ' days')::interval
            + ((abs(hashtext(o.id::text)) % 900) || ' minutes')::interval end,
  case when (abs(hashtext(a.n::text || o.id::text)) % 100) < 82
       then (select m.user_id from public.memberships m
              where m.org_id = o.id and m.role = 'owner' and m.status = 'active' limit 1) end,
  timezone('utc', now()) - (a.days_ago || ' days')::interval
from pf_announcement a
cross join pf_org o
where a.status = 'sent'
  and (a.audience = 'all' or o.plan = any (a.plans))
on conflict (announcement_id, org_id) do nothing;

-- =====================================================================
-- 7. Integrations — connections and a week of sync runs
-- =====================================================================
insert into public.org_integrations
  (id, org_id, connector_key, status, credentials_ref, connected_at, last_sync_at)
select
  pg_temp.pf_uuid(format('orgint:%s:%s', o.n, c.key)),
  o.id, c.key,
  case when o.n % 7 = 3 and c.key = 'brighthr' then 'error' else 'connected' end,
  c.key || '_cred_' || lpad(o.n::text, 3, '0'),
  timezone('utc', now()) - ((30 + o.n * 7) || ' days')::interval,
  timezone('utc', now()) - ((abs(hashtext(c.key || o.id::text)) % 90) || ' minutes')::interval
from pf_org o
cross join (values ('sage_payroll'), ('xero'), ('google_calendar'), ('brighthr'), ('slack')) as c(key)
-- Not every tenant connects everything: a connector every organisation uses
-- tells you nothing about which ones matter.
where (abs(hashtext(c.key || o.id::text)) % 10) < 7
on conflict (org_id, connector_key) do nothing;

-- Seven days of runs, four per day per connection. Failures cluster on the
-- degraded connector, which is what makes its success rate worth reading.
insert into public.integration_sync_runs
  (id, org_integration_id, connector_key, org_id, started_at, finished_at,
   duration_ms, outcome, records, error)
select
  pg_temp.pf_uuid(format('syncrun:%s:%s:%s', oi.id, d, r)),
  oi.id, oi.connector_key, oi.org_id,
  timezone('utc', now()) - (d || ' days')::interval - ((r * 6) || ' hours')::interval,
  timezone('utc', now()) - (d || ' days')::interval - ((r * 6) || ' hours')::interval
    + ((900 + (abs(hashtext(oi.id::text || d::text || r::text)) % 5200)) || ' milliseconds')::interval,
  900 + (abs(hashtext(oi.id::text || d::text || r::text)) % 5200),
  case
    when oi.connector_key = 'brighthr'
         and (abs(hashtext(oi.id::text || d::text || r::text)) % 100) < 9 then 'failed'
    when (abs(hashtext(oi.id::text || d::text || r::text)) % 100) < 2 then 'failed'
    when (abs(hashtext(oi.id::text || d::text || r::text)) % 100) < 5 then 'partial'
    else 'success'
  end,
  (abs(hashtext(oi.id::text || d::text || r::text)) % 240),
  case when oi.connector_key = 'brighthr'
            and (abs(hashtext(oi.id::text || d::text || r::text)) % 100) < 9
       then 'upstream 502 from api.brighthr.com' end
from public.org_integrations oi
cross join generate_series(0, 6) d
cross join generate_series(0, 3) r
where oi.id in (select pg_temp.pf_uuid(format('orgint:%s:%s', o.n, c.key))
                  from pf_org o
                  cross join (values ('sage_payroll'), ('xero'), ('google_calendar'),
                                     ('brighthr'), ('slack')) as c(key))
on conflict (id) do nothing;

-- =====================================================================
-- 8. Health samples — 24 hours of probes, every 15 minutes
-- =====================================================================
-- `source = 'manual'` marks these as seeded rather than measured. The console
-- shows the source, so a seeded uptime figure can never be mistaken for one
-- a probe produced.
insert into public.platform_health_samples (service, status, latency_ms, source, checked_at)
select
  s.service,
  case when (abs(hashtext(s.service || t::text)) % 1000) < 4 then 'degraded'
       else 'operational' end,
  s.base_ms + (abs(hashtext(s.service || t::text)) % s.jitter_ms),
  'manual',
  timezone('utc', now()) - (t * 15 || ' minutes')::interval
from (values
        ('Database',        18, 40),
        ('Authentication',  32, 55),
        ('Realtime',        24, 70),
        ('Edge Functions',  95, 180),
        ('Storage',         48, 90)
     ) as s(service, base_ms, jitter_ms)
cross join generate_series(0, 95) t;

-- =====================================================================
-- 9. Background jobs — a queue with depth and a few failures
-- =====================================================================
insert into public.background_jobs
  (id, queue, job_key, status, attempts, org_id, scheduled_for, started_at, finished_at, error)
select
  pg_temp.pf_uuid('job:' || g),
  (array['rota-publish','payroll-export','notifications','reminders'])[(g % 4) + 1],
  (array['publish_rota','export_timesheets','send_digest','shift_reminder'])[(g % 4) + 1]
    || ':' || g,
  case when g % 11 = 0 then 'failed'
       when g <= 9      then 'queued'
       when g % 7 = 0   then 'running'
       else 'succeeded' end,
  case when g % 11 = 0 then 3 else 1 end,
  (select id from pf_org where n = (g % greatest((select count(*) from pf_org), 1)) + 1),
  timezone('utc', now()) - ((g * 4) || ' minutes')::interval,
  case when g > 9 then timezone('utc', now()) - ((g * 4) || ' minutes')::interval + interval '2 seconds' end,
  case when g > 9 and g % 7 <> 0
       then timezone('utc', now()) - ((g * 4) || ' minutes')::interval + interval '9 seconds' end,
  case when g % 11 = 0 then 'timeout after 30s waiting on the payroll connector' end
from generate_series(1, 48) g;

-- =====================================================================
-- 10. Console security — the allowlist the Security tab reports
-- =====================================================================
insert into public.platform_ip_allowlist (id, cidr, label)
values
  (pg_temp.pf_uuid('allow:1'), '0.0.0.0/0'::cidr, 'Unrestricted — no ranges enforced yet')
on conflict (cidr) do nothing;

-- =====================================================================
-- What this produced
-- =====================================================================
select 'incidents'      as table_name, count(*) from public.incidents
union all select 'incident_updates',   count(*) from public.incident_updates
union all select 'support_cases',      count(*) from public.support_cases
union all select 'case_messages',      count(*) from public.support_case_messages
union all select 'announcements',      count(*) from public.platform_announcements
union all select 'deliveries',         count(*) from public.platform_announcement_deliveries
union all select 'invoices',           count(*) from public.invoices
union all select 'org_integrations',   count(*) from public.org_integrations
union all select 'sync_runs',          count(*) from public.integration_sync_runs
union all select 'health_samples',     count(*) from public.platform_health_samples
union all select 'background_jobs',    count(*) from public.background_jobs
union all select 'feature_flags',      count(*) from public.feature_flags
union all select 'plans',              count(*) from public.plans;
