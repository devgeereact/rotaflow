-- =====================================================================
-- 0076_scheduled_health_probe.sql — uptime stops meaning "an
-- administrator opened a page" (docs/SAAS.md GAP-011)
--
-- `platform_health_samples` has existed since 0027 and the only thing
-- that ever wrote to it was the console, when a human opened System
-- status. So "uptime, 24 hours" was arithmetic over the moments somebody
-- happened to look, from their own laptop, on their own wifi — and an
-- outage at 3am left no trace at all, because nobody was looking.
--
-- This adds the missing writer: pg_cron every five minutes, whether or
-- not anyone is watching.
--
-- ## What it can honestly measure, and what it cannot
--
-- **The database.** If this function runs, Postgres is up. That is the
-- whole measurement and it is a real one — a tick that does not happen
-- leaves no row, and the uptime window notices the gap. It records
-- `latency_ms = null` rather than timing `select 1`: a query timed
-- inside the backend executing it measures nothing anyone cares about,
-- and a microsecond figure presented as "database latency" is fake
-- precision.
--
-- **Auth and REST, over pg_net.** Real HTTP to the real endpoints, from
-- inside the region. Status only, again with `latency_ms = null`, and
-- this one deserves the explanation:
--
--     `net._http_response` records no duration. The only timing
--     available is `created - sent_at`, and `created` is when the pg_net
--     background worker got round to writing the row — so it includes
--     that worker's polling interval, not just the round trip. A latency
--     number built from it would look precise and be mostly scheduler
--     noise. Status is solid; duration is not, so duration is not
--     recorded.
--
-- **Not Edge Functions.** Each needs credentials and two of them cost
-- money per invocation. Probing them is a real gap, deliberately left.
--
-- So this migration makes UPTIME trustworthy and deliberately does not
-- touch LATENCY, which keeps coming from console probes — a genuine
-- browser round trip, correctly labelled as one.
--
-- ## The view had to change, or it would have quietly gone wrong
--
-- 0027 wrote, of the `source` column:
--
--     "A browser in London and a cron in eu-west-2 measure different
--      things, and averaging them silently would be the kind of number
--      that survives until someone depends on it."
--
-- `platform_health_summary` had no source filter, because until now only
-- one source existed. Adding a second would have made 0027's own warning
-- come true on the next tick.
--
-- The view now answers its two questions separately, which the first
-- draft of this migration got wrong and is worth recording. UPTIME uses
-- one source per service: scheduled where it exists, console otherwise,
-- named in a new `measured_from` column. LATENCY cannot use the same
-- rule — scheduled probes record no duration, so preferring them would
-- have turned the console's real browser-measured p95 into a null that
-- reads on screen as "Not sampled", deleting a true figure in the name
-- of a better one. Percentiles therefore come from whatever actually
-- timed something, named in `latency_from`.
--
-- Still one row per service, and both new columns are additive as far as
-- any READER is concerned. Not as far as `create or replace view` is
-- concerned, though — see the note above the view itself.
--
-- ## Retention, deliberately not in `retention_policies`
--
-- At 3 services every 5 minutes this writes ~315,000 rows a year and
-- nothing has ever pruned the table. The probe prunes at 90 days itself
-- rather than gaining a `retention_policies` row, because that register
-- is the customer-facing data-protection one: it lists what personal
-- data is kept and for how long, and it is read on the GDPR screen and
-- in the Privacy Notice. Platform telemetry about our own servers holds
-- no personal data, and adding it there would misrepresent both.
--
-- MIGRATION RISK. One new table (in-flight probe bookkeeping), one
-- function, one view replaced additively, one cron job. No existing row
-- is rewritten. `record_health_sample` is untouched, so the console path
-- is exactly as it was. Reversible by unscheduling the job; the view
-- reverts by re-applying 0027's definition.
--
-- If the Vault secrets are absent the probe records the database sample
-- and warns, rather than failing silently — the same fail-loud rule
-- 0069 uses, for the same reason.
-- =====================================================================

-- ── in-flight bookkeeping ─────────────────────────────────────────────
-- pg_net is asynchronous: `net.http_get` returns a request id and the
-- response lands later. This is the row that remembers which service a
-- request was for, so the next tick can reconcile it. Rows live for one
-- tick and are deleted as they are read.
create table if not exists public.platform_health_probes (
  request_id bigint primary key,
  service    text not null,
  sent_at    timestamptz not null default timezone('utc', now())
);

comment on table public.platform_health_probes is
  'In-flight pg_net health probes, awaiting reconciliation on the next cron tick. Never more than a handful of rows; not a history — platform_health_samples is.';

alter table public.platform_health_probes enable row level security;

-- No policy at all, deliberately: nothing outside the probe function has
-- any reason to read this, and the function is security definer.
revoke all on public.platform_health_probes from anon, authenticated;

-- ── the probe ─────────────────────────────────────────────────────────
create or replace function public.probe_platform_health()
returns integer
language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  v_origin text;
  v_anon   text;
  v_row    record;
  v_resp   record;
  v_status text;
  v_wrote  integer := 0;
begin
  -- 1. Reconcile last tick's requests. Anything older than a minute has
  --    either landed or timed out, so a missing response row is itself the
  --    answer: the service did not reply.
  for v_row in
    select * from public.platform_health_probes
     where sent_at < timezone('utc', now()) - interval '1 minute'
  loop
    select status_code, timed_out into v_resp
      from net._http_response where id = v_row.request_id;

    v_status := case
      when v_resp.status_code is null or v_resp.timed_out then 'down'
      when v_resp.status_code >= 500 then 'down'
      when v_resp.status_code >= 400 then 'degraded'
      else 'operational'
    end;

    insert into public.platform_health_samples (service, status, latency_ms, source)
    values (v_row.service, v_status, null, 'scheduled');

    delete from public.platform_health_probes where request_id = v_row.request_id;
    v_wrote := v_wrote + 1;
  end loop;

  -- 2. The database. This function running IS the measurement; a tick that
  --    does not happen leaves no row, and the window notices the gap.
  --    Inserted directly rather than through `record_health_sample`, which
  --    requires `is_platform_admin()` — cron has no `auth.uid()`, and
  --    loosening that check so a scheduler could pass it would open the
  --    store 0027 deliberately closed.
  insert into public.platform_health_samples (service, status, latency_ms, source)
  values ('PostgreSQL database', 'operational', null, 'scheduled');
  v_wrote := v_wrote + 1;

  -- 3. Fire this tick's HTTP probes.
  select decrypted_secret into v_anon
    from vault.decrypted_secrets where name = 'supabase_anon_key';

  select decrypted_secret into v_origin
    from vault.decrypted_secrets where name = 'supabase_url';

  if v_origin is null then
    -- Derive it rather than demand a second secret for the same fact.
    -- `send_notification_url` is already provisioned and is
    -- https://<ref>.supabase.co/functions/v1/send-notification.
    select substring(decrypted_secret from '^https?://[^/]+') into v_origin
      from vault.decrypted_secrets where name = 'send_notification_url';
  end if;

  if v_origin is null or v_anon is null then
    -- Loud, not silent. A missing secret must not read as "everything is
    -- fine" on a screen whose entire job is to say whether it is.
    raise warning 'probe_platform_health: cannot probe HTTP endpoints (origin=%, anon key=%)',
      v_origin is not null, v_anon is not null;
    return v_wrote;
  end if;

  insert into public.platform_health_probes (request_id, service)
  values (
    net.http_get(
      url     := v_origin || '/auth/v1/health',
      headers := jsonb_build_object('apikey', v_anon)
    ),
    'Authentication'
  );

  insert into public.platform_health_probes (request_id, service)
  values (
    net.http_get(
      url     := v_origin || '/rest/v1/',
      headers := jsonb_build_object('apikey', v_anon)
    ),
    'REST API'
  );

  -- 4. Prune. See the header for why this is here and not in
  --    `retention_policies`.
  delete from public.platform_health_samples
   where checked_at < timezone('utc', now()) - interval '90 days';

  return v_wrote;
end;
$$;

comment on function public.probe_platform_health() is
  'Writes platform_health_samples with source = scheduled, every five minutes, whether or not anyone is looking. Records status only: see 0076 for why no latency is recorded from a pg_net probe.';

revoke all on function public.probe_platform_health() from public, anon, authenticated;

-- ── the view stops blending sources ───────────────────────────────────
-- DROP then CREATE, not CREATE OR REPLACE.
--
-- `create or replace view` can only APPEND columns; it cannot rename or
-- reorder existing ones, and this puts `measured_from` where 0027 had
-- `samples_24h`. Postgres refuses with
--
--     cannot change name of view column "samples_24h" to "measured_from"
--     (SQLSTATE 42P16)
--
-- The first version of this file used `or replace` and was caught by the
-- `db-tests` CI job, which applies every migration to a fresh Postgres.
-- Validating the SELECT on its own — which is what I did — proves the query
-- works and says nothing about whether the DDL will apply.
--
-- Dropping a view drops its grants with it, so they are re-issued below.
-- Nothing depends on this view but the client, so there is no cascade.
drop view if exists public.platform_health_summary;

create view public.platform_health_summary
with (security_invoker = true) as
with recent as (
  select * from public.platform_health_samples
   where checked_at > timezone('utc', now()) - interval '24 hours'
),
-- Which source answers the UPTIME question for each service. Synthetic
-- monitoring wins where it exists; a human opening the console is the
-- fallback, not an ingredient. ('console' also covers the historical
-- 'manual' rows — it means "somebody was present", as against a scheduler.)
chosen as (
  select service,
         case when bool_or(source = 'scheduled') then 'scheduled' else 'console' end
           as measured_from
    from recent
   group by service
),
uptime as (
  select r.service,
         c.measured_from,
         count(*)                                         as samples_24h,
         count(*) filter (where r.status = 'operational')  as ok_24h,
         max(r.checked_at)                                as last_checked_at
    from recent r
    join chosen c on c.service = r.service
   where (c.measured_from = 'scheduled' and r.source =  'scheduled')
      or (c.measured_from = 'console'   and r.source <> 'scheduled')
   group by r.service, c.measured_from
),
-- LATENCY is a different question and must not be answered by the same
-- filter. Scheduled probes deliberately record no duration (see the header),
-- so preferring them for percentiles would turn the console's real,
-- browser-measured p95 into a null that reads on screen as "Not sampled" —
-- deleting a true figure in the name of a better one. Percentiles come from
-- whatever actually timed something, with the source named.
latency as (
  select service,
         case when bool_or(source = 'scheduled') then 'scheduled' else 'console' end
           as latency_from,
         percentile_cont(0.5)  within group (order by latency_ms) as p50_ms,
         percentile_cont(0.95) within group (order by latency_ms) as p95_ms,
         percentile_cont(0.99) within group (order by latency_ms) as p99_ms
    from recent
   where latency_ms is not null
   group by service
)
select
  u.service,
  u.measured_from,
  u.samples_24h,
  u.ok_24h,
  round(100.0 * u.ok_24h / nullif(u.samples_24h, 0), 2) as uptime_pct_24h,
  l.latency_from,
  l.p50_ms,
  l.p95_ms,
  l.p99_ms,
  u.last_checked_at
from uptime u
left join latency l on l.service = u.service;

comment on view public.platform_health_summary is
  'Last 24 hours per service. UPTIME is computed from one source — scheduled probes where they exist, console probes otherwise — because averaging a browser round trip with an in-region one produces a number nobody can interpret; measured_from says which was used. LATENCY is computed separately, from whatever actually recorded a duration, because scheduled probes deliberately record none (0076); latency_from names that source. Null percentiles mean nothing timed was sampled, not that latency was zero.';

-- Re-granted after the drop. Narrower than 0056, which handed out
-- `insert, update, delete` on a summary view as well — meaningless on an
-- aggregate and inconsistent with 0075's direction of travel. `anon` gets
-- nothing, matching 0075.
grant select on public.platform_health_summary to authenticated, service_role;

-- ── schedule ──────────────────────────────────────────────────────────
-- Every five minutes. Frequent enough that a short outage leaves a mark,
-- infrequent enough that the table stays small. Retention (0029) runs
-- nightly at 02:15 and the notification outbox every minute; this sits
-- between them.
select cron.unschedule('rotaflow-health-probe')
  where exists (select 1 from cron.job where jobname = 'rotaflow-health-probe');

select cron.schedule(
  'rotaflow-health-probe',
  '*/5 * * * *',
  $cron$select public.probe_platform_health();$cron$
);
