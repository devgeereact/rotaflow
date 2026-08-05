-- =====================================================================
-- 0027 — The rest of the platform configuration
--
-- Branding, console security, email, storage limits, data retention and the
-- API tab were all placeholder because none of them had anywhere to live.
-- This gives each one a store, plus the three things the console needed and
-- could not read: an IP allowlist, a retention schedule, and the account facts
-- that live in `auth.users`.
--
-- ## What a setting here does and does not do
--
-- A stored setting is a decision, not always an enforcement point. `require_mfa`
-- is enforced by Supabase Auth; `session_timeout_minutes` is enforced by the
-- console; `max_upload_mb` is enforced by whatever accepts an upload. Storing
-- them in one place is what lets those enforcement points agree — and the
-- console labels which is which rather than implying the row is the control.
-- =====================================================================

-- ---------- Branding ----------------------------------------------------
alter table public.platform_settings
  add column if not exists logo_url          text,
  add column if not exists favicon_url       text,
  add column if not exists primary_colour    text not null default '#3B6FE0'
      check (primary_colour ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists support_branding  boolean not null default true,

  -- ---------- Console security -----------------------------------------
  add column if not exists require_mfa               boolean not null default true,
  add column if not exists admin_session_minutes     integer not null default 30
      check (admin_session_minutes between 5 and 480),
  add column if not exists max_concurrent_sessions   integer not null default 2
      check (max_concurrent_sessions between 1 and 10),
  add column if not exists signin_alerts             boolean not null default true,
  add column if not exists reauth_for_critical       boolean not null default true,

  -- ---------- Email -----------------------------------------------------
  -- The sender address must be on a domain with published SPF and DKIM.
  -- rota.gakinz.com has neither, so mail sent as that subdomain is dropped
  -- silently by Gmail — the default here is the domain that is actually signed.
  add column if not exists email_sender_name    text not null default 'RotaFlow',
  add column if not exists email_sender_address text not null default 'info@gakinz.com',
  add column if not exists email_provider       text not null default 'smtp'
      check (email_provider in ('smtp','postmark','resend','ses')),

  -- ---------- Storage ---------------------------------------------------
  add column if not exists max_upload_mb        integer not null default 25
      check (max_upload_mb between 1 and 512),
  add column if not exists permitted_file_types text[] not null
      default array['pdf','png','jpg','jpeg','csv','xlsx'],

  -- ---------- API -------------------------------------------------------
  add column if not exists public_api_enabled   boolean not null default false,
  add column if not exists api_rate_limit_per_min integer not null default 600
      check (api_rate_limit_per_min > 0),
  add column if not exists webhook_max_attempts integer not null default 5
      check (webhook_max_attempts between 1 and 20);

comment on column public.platform_settings.email_sender_address is
  'Must be a domain with published SPF and DKIM. A subdomain without them is accepted by SMTP and dropped by the recipient.';

comment on column public.platform_settings.require_mfa is
  'A recorded decision. Supabase Auth is the enforcement point; the console reports this and says so.';

-- ---------- Who may reach the console ----------------------------------
create table if not exists public.platform_ip_allowlist (
  id          uuid primary key default gen_random_uuid(),
  -- inet/cidr rather than text: Postgres validates the range, and `>>=` gives
  -- containment for free. A text column accepts "192.168.0.0/33".
  cidr        cidr not null unique,
  label       text not null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default timezone('utc', now())
);

comment on table public.platform_ip_allowlist is
  'Ranges permitted to reach /admin. Empty means unrestricted — an allowlist that locks everyone out is worse than none.';

-- ---------- How long things are kept -----------------------------------
create table if not exists public.retention_policies (
  data_type     text primary key,
  label         text not null,
  -- Null means indefinite. Zero would mean "delete immediately", which is a
  -- different and much more dangerous statement.
  retain_months integer check (retain_months is null or retain_months > 0),
  -- Whether anything actually enforces it yet. The console shows this rather
  -- than letting a reader assume a schedule is a job.
  enforced      boolean not null default false,
  note          text not null default '',
  updated_at    timestamptz not null default timezone('utc', now())
);

comment on table public.retention_policies is
  'The retention schedule, with an explicit flag for whether a job enforces it. An unenforced policy is an intention.';

insert into public.retention_policies (data_type, label, retain_months, enforced, note)
values
  ('rota_history',    'Rota and shift history',   84,   false, 'Kept for payroll and dispute resolution.'),
  ('attendance',      'Attendance and clock-in',  36,   false, 'Clock-in, clock-out and GPS traces.'),
  ('leave',           'Leave records',            72,   false, 'Statutory holiday and sickness records.'),
  ('support_cases',   'Support cases',            36,   false, 'Correspondence and internal notes.'),
  ('audit_log',       'Platform audit log',       null, true,  'Immutable: the table carries no update or delete policy at all.'),
  ('deleted_tenant',  'Deleted tenant data',      1,    false, 'Thirty-day grace, then erasure.')
on conflict (data_type) do nothing;

-- ---------- What the platform is measuring about itself ----------------
-- Probes recorded over time, so uptime and p95 are computed from samples
-- rather than asserted. Written by whoever probed — the console when an
-- administrator opens System status, or a scheduled Edge Function.
create table if not exists public.platform_health_samples (
  id          bigint generated always as identity primary key,
  service     text not null,
  status      text not null check (status in ('operational','degraded','down')),
  latency_ms  integer check (latency_ms is null or latency_ms >= 0),
  -- Where the sample came from. A browser in London and a cron in eu-west-2
  -- measure different things, and averaging them silently would be the kind of
  -- number that survives until someone depends on it.
  source      text not null default 'console' check (source in ('console','scheduled','manual')),
  checked_at  timestamptz not null default timezone('utc', now())
);

comment on table public.platform_health_samples is
  'Individual probe results. Uptime and percentiles are queries over this, with the source kept so console samples are never mistaken for synthetic monitoring.';

create index if not exists health_samples_service_idx
  on public.platform_health_samples (service, checked_at desc);

-- Rolling summary, so a screen does not pull a week of samples to a browser.
create or replace view public.platform_health_summary
with (security_invoker = true) as
select
  service,
  count(*)                                        as samples_24h,
  count(*) filter (where status = 'operational')  as ok_24h,
  round(100.0 * count(*) filter (where status = 'operational') / nullif(count(*), 0), 2)
                                                  as uptime_pct_24h,
  percentile_cont(0.5)  within group (order by latency_ms) as p50_ms,
  percentile_cont(0.95) within group (order by latency_ms) as p95_ms,
  percentile_cont(0.99) within group (order by latency_ms) as p99_ms,
  max(checked_at)                                 as last_checked_at
from public.platform_health_samples
where checked_at > timezone('utc', now()) - interval '24 hours'
group by service;

comment on view public.platform_health_summary is
  'Last 24 hours per service. Null percentiles mean nothing was sampled, not that latency was zero.';

create or replace function public.record_health_sample(
  p_service    text,
  p_status     text,
  p_latency_ms integer default null,
  p_source     text default 'console'
) returns void language plpgsql security definer set search_path = public as $$
begin
  -- Platform staff only. A sample store any signed-in session could write to
  -- is a store whose uptime figure a customer can move.
  if not public.is_platform_admin() then
    raise exception 'Only platform staff can record a health sample'
      using errcode = '42501';
  end if;

  insert into public.platform_health_samples (service, status, latency_ms, source)
  values (btrim(p_service), p_status, p_latency_ms, p_source);
end;
$$;

revoke all on function public.record_health_sample(text, text, integer, text) from public, anon;
grant execute on function public.record_health_sample(text, text, integer, text) to authenticated;

-- ---------- Background work ---------------------------------------------
-- Queue depth and job failures had no store. Inngest runs the work; this is
-- the record it writes back so the console can report it without asking a
-- third party's API from a browser.
create table if not exists public.background_jobs (
  id           uuid primary key default gen_random_uuid(),
  queue        text not null,
  job_key      text not null,
  status       text not null default 'queued'
                 check (status in ('queued','running','succeeded','failed','cancelled')),
  attempts     integer not null default 0 check (attempts >= 0),
  org_id       uuid references public.organisations(id) on delete cascade,
  payload      jsonb not null default '{}'::jsonb,
  error        text,
  scheduled_for timestamptz not null default timezone('utc', now()),
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz not null default timezone('utc', now())
);

comment on table public.background_jobs is
  'Queued and completed background work. Queue depth is a count of queued rows, not a guess.';

create index if not exists background_jobs_queue_idx
  on public.background_jobs (queue, status, scheduled_for);

-- ---------- The account facts that live in auth.users ------------------
-- Email confirmation, last sign-in and MFA enrolment are in `auth.users`,
-- which no client may read. This function is the deliberate, narrow window:
-- three facts, platform staff only, and nothing else from that table — not the
-- password hash, not the recovery token, not the raw metadata.
create or replace function public.platform_user_auth_facts(p_user uuid)
returns table (
  email_confirmed_at timestamptz,
  last_sign_in_at    timestamptz,
  mfa_enrolled       boolean,
  banned_until       timestamptz
) language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform staff can read account security facts'
      using errcode = '42501';
  end if;

  return query
    select u.email_confirmed_at,
           u.last_sign_in_at,
           exists (select 1 from auth.mfa_factors f
                    where f.user_id = u.id and f.status = 'verified'),
           u.banned_until
      from auth.users u
     where u.id = p_user;
end;
$$;

comment on function public.platform_user_auth_facts(uuid) is
  'Three facts from auth.users, for platform staff. Deliberately not a view: a view would be one grant away from leaking the whole table.';

revoke all on function public.platform_user_auth_facts(uuid) from public, anon;
grant execute on function public.platform_user_auth_facts(uuid) to authenticated;

-- The same three facts across every account, for the Users screen's tiles.
-- One round trip instead of one per row.
create or replace function public.platform_auth_facts_summary()
returns table (
  total_accounts   bigint,
  unverified       bigint,
  active_30d       bigint,
  inactive_90d     bigint,
  mfa_enrolled     bigint,
  banned           bigint
) language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform staff can read account security facts'
      using errcode = '42501';
  end if;

  return query
    select
      count(*),
      count(*) filter (where u.email_confirmed_at is null),
      count(*) filter (where u.last_sign_in_at > timezone('utc', now()) - interval '30 days'),
      -- Never signed in counts as inactive: an account created a year ago and
      -- never used is exactly what this tile is for.
      count(*) filter (where u.last_sign_in_at is null
                          or u.last_sign_in_at < timezone('utc', now()) - interval '90 days'),
      count(*) filter (where exists (select 1 from auth.mfa_factors f
                                      where f.user_id = u.id and f.status = 'verified')),
      count(*) filter (where u.banned_until is not null
                          and u.banned_until > timezone('utc', now()))
    from auth.users u;
end;
$$;

revoke all on function public.platform_auth_facts_summary() from public, anon;
grant execute on function public.platform_auth_facts_summary() to authenticated;

-- ---------- Audit: what changed, not just that something did -----------
-- The console's Before and After columns were reading scalars out of
-- free-form metadata. These are the columns that should have carried them:
-- indexed, typed, and impossible to confuse with a payload that may hold
-- personal data.
alter table public.audit_logs
  add column if not exists before_value text,
  add column if not exists after_value  text;

comment on column public.audit_logs.before_value is
  'The prior value, as a short scalar. Never a payload: metadata is where a structure goes, and it is not shown in the standard audit view.';

-- Backfilled from the metadata the writers have been using since 0016, so the
-- history already recorded does not start blank in the new columns.
update public.audit_logs
   set before_value = coalesce(before_value, metadata->>'before'),
       after_value  = coalesce(after_value,  metadata->>'after')
 where (metadata ? 'before' or metadata ? 'after')
   and (before_value is null and after_value is null);

-- `audit_write` gains the two columns without changing its signature: the
-- callers already pass before/after inside the metadata object, and this
-- copies them out rather than asking forty call sites to change.
create or replace function public.audit_write(
  p_org         uuid,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_metadata    jsonb,
  p_severity    text,
  p_visibility  text default 'org'
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_email    text;
  v_name     text;
  v_org_name text;
begin
  select p.email, p.full_name into v_email, v_name
    from public.profiles p where p.id = auth.uid();
  select o.name into v_org_name
    from public.organisations o where o.id = p_org;

  insert into public.audit_logs (
    org_id, org_name, actor_user_id, actor_email, actor_name,
    action, entity_type, entity_id, metadata, severity, scope, visibility,
    before_value, after_value)
  values (
    p_org, v_org_name, auth.uid(), v_email, v_name,
    p_action, p_entity_type, p_entity_id,
    coalesce(p_metadata, '{}'::jsonb)
      || case when auth.uid() is null
              then jsonb_build_object('via', 'service_role')
              else '{}'::jsonb end,
    p_severity,
    case when p_org is null then 'platform' else 'org' end,
    p_visibility,
    -- Only scalars are lifted. An object in `before` stays in the metadata,
    -- where the standard audit view does not display it.
    case when jsonb_typeof(p_metadata->'before') in ('string','number','boolean')
         then p_metadata->>'before' end,
    case when jsonb_typeof(p_metadata->'after') in ('string','number','boolean')
         then p_metadata->>'after' end);
end;
$$;

revoke all on function public.audit_write(uuid, text, text, uuid, jsonb, text, text)
  from public, anon, authenticated;

-- ---------- Row level security -----------------------------------------
alter table public.platform_ip_allowlist    enable row level security;
alter table public.retention_policies       enable row level security;
alter table public.platform_health_samples  enable row level security;
alter table public.background_jobs          enable row level security;

drop policy if exists platform_ip_allowlist_select on public.platform_ip_allowlist;
create policy platform_ip_allowlist_select
  on public.platform_ip_allowlist for select
  using (public.is_platform_admin());

-- The retention schedule is readable by any signed-in user: "how long do you
-- keep my clock-ins" is a question a staff member is entitled to ask, and a
-- privacy notice that contradicts the database is worse than no notice.
drop policy if exists retention_policies_select on public.retention_policies;
create policy retention_policies_select
  on public.retention_policies for select
  using (auth.uid() is not null);

drop policy if exists platform_health_samples_select on public.platform_health_samples;
create policy platform_health_samples_select
  on public.platform_health_samples for select
  using (public.is_platform_admin());

drop policy if exists background_jobs_select on public.background_jobs;
create policy background_jobs_select
  on public.background_jobs for select
  using (public.is_platform_admin() or (org_id is not null and public.is_org_member(org_id)));

revoke insert, update, delete on public.platform_ip_allowlist   from anon, authenticated;
revoke insert, update, delete on public.retention_policies      from anon, authenticated;
revoke insert, update, delete on public.platform_health_samples from anon, authenticated;
revoke insert, update, delete on public.background_jobs         from anon, authenticated;
