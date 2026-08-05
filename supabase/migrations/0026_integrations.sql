-- =====================================================================
-- 0026 — Integration connectors and their sync history
--
-- The Integrations console listed connectors, how many organisations use each,
-- a success rate, a median sync time and a failure count. All of it was
-- invented, because nothing recorded a sync.
--
-- ## Two tables, because they answer different questions
--
-- `integration_connectors` is the catalogue: what can be connected, and what
-- state the connector itself is in. `org_integrations` is one tenant's
-- connection: their credentials reference, their last sync, their failures.
-- Organisations-connected and failure counts are then sums over the second,
-- never columns on the first, so they cannot drift from the rows they claim to
-- summarise.
--
-- ## Credentials are not here
--
-- `credentials_ref` names a secret held by an Edge Function or a provider. No
-- token, key or password is stored in this schema — the console reads which
-- tenants have connected what, and can never read what they connected with.
-- =====================================================================

create table if not exists public.integration_connectors (
  key           text primary key check (key ~ '^[a-z][a-z0-9_]{2,63}$'),
  name          text not null,
  category      text not null
                  check (category in ('payroll','hr','calendar','communication','accounting','identity')),
  description   text not null default '',

  -- The connector's own health, set by whoever operates it. Distinct from a
  -- tenant's connection failing, which is in the other table.
  status        text not null default 'operational'
                  check (status in ('operational','degraded','down','beta','retired')),

  -- Whether tenants may connect it at all. A retired connector keeps its rows
  -- and refuses new connections.
  available     boolean not null default true,

  docs_url      text,
  created_at    timestamptz not null default timezone('utc', now()),
  updated_at    timestamptz not null default timezone('utc', now())
);

comment on table public.integration_connectors is
  'The connector catalogue. Usage counts are sums over org_integrations, never columns here.';

create table if not exists public.org_integrations (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organisations(id) on delete cascade,
  connector_key  text not null references public.integration_connectors(key) on delete cascade,

  status         text not null default 'connected'
                   check (status in ('connected','paused','error','disconnected')),

  -- A name, never a secret. The secret lives with the Edge Function that uses
  -- it; this column exists so support can say which credential broke.
  credentials_ref text,

  connected_by   uuid references public.profiles(id) on delete set null,
  connected_at   timestamptz not null default timezone('utc', now()),
  last_sync_at   timestamptz,
  last_error     text,

  created_at     timestamptz not null default timezone('utc', now()),
  updated_at     timestamptz not null default timezone('utc', now()),

  unique (org_id, connector_key)
);

comment on table public.org_integrations is
  'One tenant''s connection to one connector. Holds a credentials reference, never a credential.';

create index if not exists org_integrations_connector_idx
  on public.org_integrations (connector_key, status);

-- Every attempt, kept for a rolling window. Success rate, median duration and
-- "failed in the last 24 hours" are all queries over this.
create table if not exists public.integration_sync_runs (
  id             uuid primary key default gen_random_uuid(),
  org_integration_id uuid not null references public.org_integrations(id) on delete cascade,
  connector_key  text not null references public.integration_connectors(key) on delete cascade,
  org_id         uuid not null references public.organisations(id) on delete cascade,

  started_at     timestamptz not null default timezone('utc', now()),
  finished_at    timestamptz,
  duration_ms    integer check (duration_ms is null or duration_ms >= 0),

  outcome        text not null default 'running'
                   check (outcome in ('running','success','partial','failed')),
  records        integer not null default 0 check (records >= 0),
  error          text,

  constraint sync_finished_after_start
    check (finished_at is null or finished_at >= started_at),
  constraint sync_finished_has_outcome
    check (outcome = 'running' or finished_at is not null)
);

comment on table public.integration_sync_runs is
  'One sync attempt. The Integrations screen''s success rate and medians are queries over this table.';

create index if not exists sync_runs_recent_idx
  on public.integration_sync_runs (connector_key, started_at desc);

create index if not exists sync_runs_failed_idx
  on public.integration_sync_runs (started_at desc)
  where outcome = 'failed';

drop trigger if exists integration_connectors_set_updated_at on public.integration_connectors;
create trigger integration_connectors_set_updated_at
  before update on public.integration_connectors
  for each row execute function public.set_updated_at();

drop trigger if exists org_integrations_set_updated_at on public.org_integrations;
create trigger org_integrations_set_updated_at
  before update on public.org_integrations
  for each row execute function public.set_updated_at();

-- ---------- What the console asks for, as one query --------------------
-- A view rather than six round trips: the screen wants a row per connector
-- with its usage and its health, and computing that client-side means pulling
-- every sync run to the browser to divide two numbers.
create or replace view public.integration_connector_stats
with (security_invoker = true) as
select
  c.key,
  c.name,
  c.category,
  c.status,
  c.available,
  count(distinct oi.org_id) filter (where oi.status = 'connected') as orgs_connected,
  count(r.id) filter (where r.started_at > timezone('utc', now()) - interval '24 hours')
    as runs_24h,
  count(r.id) filter (where r.outcome = 'failed'
                        and r.started_at > timezone('utc', now()) - interval '24 hours')
    as failed_24h,
  -- Null when nothing ran, rather than 100%: a connector nobody used is not a
  -- connector that worked perfectly.
  case when count(r.id) filter (where r.started_at > timezone('utc', now()) - interval '7 days') = 0
       then null
       else round(
         100.0 * count(r.id) filter (where r.outcome = 'success'
                                       and r.started_at > timezone('utc', now()) - interval '7 days')
         / nullif(count(r.id) filter (where r.started_at > timezone('utc', now()) - interval '7 days'), 0),
         1)
  end as success_rate_7d,
  percentile_cont(0.5) within group (order by r.duration_ms)
    filter (where r.duration_ms is not null
              and r.started_at > timezone('utc', now()) - interval '7 days')
    as median_duration_ms,
  max(oi.last_sync_at) as last_sync_at
from public.integration_connectors c
left join public.org_integrations oi on oi.connector_key = c.key
left join public.integration_sync_runs r on r.connector_key = c.key
group by c.key, c.name, c.category, c.status, c.available;

comment on view public.integration_connector_stats is
  'Per-connector usage and reliability. security_invoker, so RLS on the underlying tables still applies.';

-- ---------- Connect / disconnect ---------------------------------------
create or replace function public.connect_integration(
  p_org       uuid,
  p_connector text,
  p_ref       text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  c public.integration_connectors;
begin
  -- The tenant's own owner connects it. Platform staff can too, because
  -- setting a payroll connector up for a customer is a real support task.
  if not (public.has_org_role(p_org, array['owner']) or public.is_platform_admin()) then
    raise exception 'Only an organisation owner can connect an integration'
      using errcode = '42501';
  end if;

  select * into c from public.integration_connectors where key = p_connector;
  if not found then
    raise exception 'No connector called %', p_connector using errcode = 'P0002';
  end if;
  if not c.available then
    raise exception 'The % connector is not available for new connections', c.name
      using errcode = '22023';
  end if;

  insert into public.org_integrations (org_id, connector_key, credentials_ref, connected_by)
  values (p_org, p_connector, nullif(btrim(coalesce(p_ref,'')),''), auth.uid())
  on conflict (org_id, connector_key)
    do update set status = 'connected',
                  credentials_ref = coalesce(excluded.credentials_ref, org_integrations.credentials_ref),
                  last_error = null
  returning id into v_id;

  perform public.audit_write(
    p_org, 'integration.connected', 'org_integration', v_id,
    jsonb_build_object('connector', p_connector, 'after', 'connected'),
    'info', 'both');

  return v_id;
end;
$$;

revoke all on function public.connect_integration(uuid, text, text) from public, anon;
grant execute on function public.connect_integration(uuid, text, text) to authenticated;

create or replace function public.set_org_integration_status(
  p_org       uuid,
  p_connector text,
  p_status    text
) returns void language plpgsql security definer set search_path = public as $$
declare
  before_status text;
begin
  if not (public.has_org_role(p_org, array['owner']) or public.is_platform_admin()) then
    raise exception 'Only an organisation owner can change an integration'
      using errcode = '42501';
  end if;

  select status into before_status from public.org_integrations
   where org_id = p_org and connector_key = p_connector;
  if before_status is null then
    raise exception 'That organisation has no % connection', p_connector
      using errcode = 'P0002';
  end if;

  update public.org_integrations
     set status = p_status
   where org_id = p_org and connector_key = p_connector;

  perform public.audit_write(
    p_org, 'integration.' || p_status, 'org_integration', null,
    jsonb_build_object('connector', p_connector, 'before', before_status, 'after', p_status),
    case when p_status = 'error' then 'warning' else 'info' end,
    'both');
end;
$$;

revoke all on function public.set_org_integration_status(uuid, text, text) from public, anon;
grant execute on function public.set_org_integration_status(uuid, text, text) to authenticated;

-- ---------- Row level security -----------------------------------------
alter table public.integration_connectors enable row level security;
alter table public.org_integrations       enable row level security;
alter table public.integration_sync_runs  enable row level security;

-- The catalogue is readable by every signed-in session: the tenant app has to
-- render the list of things you could connect.
drop policy if exists integration_connectors_select on public.integration_connectors;
create policy integration_connectors_select
  on public.integration_connectors for select
  using (auth.uid() is not null);

drop policy if exists org_integrations_select on public.org_integrations;
create policy org_integrations_select
  on public.org_integrations for select
  using (public.is_platform_admin() or public.is_org_member(org_id));

drop policy if exists integration_sync_runs_select on public.integration_sync_runs;
create policy integration_sync_runs_select
  on public.integration_sync_runs for select
  using (public.is_platform_admin() or public.is_org_member(org_id));

revoke insert, update, delete on public.integration_connectors from anon, authenticated;
revoke insert, update, delete on public.org_integrations       from anon, authenticated;
revoke insert, update, delete on public.integration_sync_runs  from anon, authenticated;

-- ---------- The catalogue ------------------------------------------------
insert into public.integration_connectors (key, name, category, description, status, available)
values
  ('sage_payroll',    'Sage Payroll',     'payroll',       'Push approved timesheets into Sage for the payroll run.',        'operational', true),
  ('xero',            'Xero',             'accounting',    'Sync invoices and payroll journals with Xero.',                  'operational', true),
  ('brighthr',        'BrightHR',         'hr',            'Two-way sync of staff records, absence and holiday balances.',   'degraded',    true),
  ('google_calendar', 'Google Calendar',  'calendar',      'Publish each staff member''s shifts to their own calendar.',     'operational', true),
  ('microsoft_365',   'Microsoft 365',    'identity',      'Single sign-on and calendar publishing via Entra ID.',           'operational', true),
  ('slack',           'Slack',            'communication', 'Post rota publications and swap requests to a channel.',         'operational', true),
  ('quickbooks',      'QuickBooks',       'accounting',    'Export payroll journals to QuickBooks Online.',                  'beta',        true),
  ('bamboohr',        'BambooHR',         'hr',            'Import staff records and contract hours from BambooHR.',         'beta',        true)
on conflict (key) do nothing;
