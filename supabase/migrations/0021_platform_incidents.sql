-- =====================================================================
-- 0021 — Platform incidents
--
-- `/admin/platform-health` measures whether the platform is reachable *right
-- now*, from the administrator's own browser. That is genuinely useful and
-- deliberately limited: each visit sees only this moment, and nothing survives
-- the page being closed.
--
-- This is the other half. When something is wrong, someone needs to be able to
-- say so once, in a place the next person will look, and have it still be there
-- afterwards. An incident is the durable record that a live probe cannot be.
--
-- ## Why the timeline is its own table
--
-- The alternative is a `notes` text column that gets appended to. That loses
-- who wrote each update and when, which is exactly what a post-incident review
-- is reconstructing. Rows are cheap; a mangled narrative is not.
--
-- ## What this deliberately does not do
--
-- It does not notify anyone. Telling customers about an incident needs a
-- delivery mechanism — email, in-app, a status page — none of which exists
-- yet, and a `notified` boolean nobody acts on would be worse than the honest
-- absence. The console says so on the screen rather than implying the box
-- being ticked reached anybody.
-- =====================================================================

create table if not exists public.platform_incidents (
  id           uuid primary key default gen_random_uuid(),

  title        text not null check (length(btrim(title)) >= 10),

  -- Severity as an operator would grade it, worst first when sorted.
  severity     text not null check (severity in ('critical','high','medium','low')),

  status       text not null default 'investigating'
                 check (status in ('investigating','identified','monitoring','resolved')),

  -- Which of the things Platform Health probes is affected. Free text rather
  -- than a foreign key: the probe list lives in application code, and an
  -- incident about something we have not thought to probe yet must still be
  -- recordable.
  service      text not null,

  -- The customer-facing consequence, in words. Required, because "what did this
  -- actually do to anyone" is the first question asked afterwards and the
  -- hardest to reconstruct later.
  impact       text not null check (length(btrim(impact)) >= 15),

  started_at   timestamptz not null default timezone('utc', now()),
  resolved_at  timestamptz,

  owner_user_id uuid references public.profiles(id) on delete set null,

  created_at   timestamptz not null default timezone('utc', now()),
  updated_at   timestamptz not null default timezone('utc', now()),

  constraint incident_resolved_after_start
    check (resolved_at is null or resolved_at >= started_at),
  -- Resolved and a resolution time travel together. Either both or neither, so
  -- an incident cannot be closed without recording when.
  constraint incident_resolved_consistently
    check ((status = 'resolved') = (resolved_at is not null))
);

comment on table public.platform_incidents is
  'Durable record of platform incidents. Platform Health measures the present moment; this is what survives it.';

create index if not exists platform_incidents_open_idx
  on public.platform_incidents (started_at desc)
  where status <> 'resolved';

create table if not exists public.incident_events (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.platform_incidents(id) on delete cascade,
  author_user_id uuid references public.profiles(id) on delete set null,
  -- Snapshotted, same reasoning as 0016's audit rows: the narrative must stay
  -- readable after an author's account is gone.
  author_name text,
  body        text not null check (length(btrim(body)) >= 5),
  created_at  timestamptz not null default timezone('utc', now())
);

create index if not exists incident_events_incident_idx
  on public.incident_events (incident_id, created_at);

drop trigger if exists platform_incidents_set_updated_at on public.platform_incidents;
create trigger platform_incidents_set_updated_at
  before update on public.platform_incidents
  for each row execute function public.set_updated_at();

-- ---------- Open one -----------------------------------------------------
create or replace function public.open_incident(
  p_title    text,
  p_severity text,
  p_service  text,
  p_impact   text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_name text;
begin
  if not public.has_platform_role(array['platform_owner','platform_admin']) then
    raise exception 'Only a platform owner or administrator can open an incident'
      using errcode = '42501';
  end if;

  insert into public.platform_incidents
    (title, severity, service, impact, owner_user_id)
  values
    (btrim(p_title), p_severity, btrim(p_service), btrim(p_impact), auth.uid())
  returning id into v_id;

  select full_name into v_name from public.profiles where id = auth.uid();

  insert into public.incident_events (incident_id, author_user_id, author_name, body)
  values (v_id, auth.uid(), v_name, 'Incident opened.');

  perform public.audit_write(
    null, 'incident.opened', 'platform_incident', v_id,
    jsonb_build_object('severity', p_severity, 'service', p_service),
    case when p_severity in ('critical','high') then 'critical' else 'warning' end,
    'platform');

  return v_id;
end;
$$;

revoke all on function public.open_incident(text, text, text, text) from public, anon;
grant execute on function public.open_incident(text, text, text, text) to authenticated;

-- ---------- Add to the timeline -----------------------------------------
create or replace function public.add_incident_event(
  p_incident uuid,
  p_body     text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_name text;
begin
  if not public.has_platform_role(
       array['platform_owner','platform_admin','platform_support']) then
    raise exception 'Only platform staff can update an incident' using errcode = '42501';
  end if;

  if not exists (select 1 from public.platform_incidents where id = p_incident) then
    raise exception 'Incident not found' using errcode = 'P0002';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();

  insert into public.incident_events (incident_id, author_user_id, author_name, body)
  values (p_incident, auth.uid(), v_name, btrim(p_body))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.add_incident_event(uuid, text) from public, anon;
grant execute on function public.add_incident_event(uuid, text) to authenticated;

-- ---------- Move it along ------------------------------------------------
create or replace function public.set_incident_status(
  p_incident uuid,
  p_status   text,
  p_note     text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  r public.platform_incidents;
  v_name text;
begin
  if not public.has_platform_role(array['platform_owner','platform_admin']) then
    raise exception 'Only a platform owner or administrator can change incident status'
      using errcode = '42501';
  end if;

  select * into r from public.platform_incidents where id = p_incident;
  if not found then
    raise exception 'Incident not found' using errcode = 'P0002';
  end if;

  -- Resolving needs a closing note. The constraint already forces a resolution
  -- timestamp; this forces the sentence that makes it mean something.
  if p_status = 'resolved'
     and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Resolving an incident needs a note saying what fixed it'
      using errcode = '23514';
  end if;

  update public.platform_incidents
     set status      = p_status,
         resolved_at = case when p_status = 'resolved'
                            then coalesce(resolved_at, timezone('utc', now()))
                            else null end
   where id = p_incident;

  select full_name into v_name from public.profiles where id = auth.uid();

  insert into public.incident_events (incident_id, author_user_id, author_name, body)
  values (p_incident, auth.uid(), v_name,
          coalesce(nullif(btrim(coalesce(p_note, '')), ''),
                   'Status changed to ' || p_status || '.'));

  perform public.audit_write(
    null, 'incident.' || p_status, 'platform_incident', p_incident,
    jsonb_build_object('from', r.status, 'to', p_status),
    'warning', 'platform');
end;
$$;

revoke all on function public.set_incident_status(uuid, text, text) from public, anon;
grant execute on function public.set_incident_status(uuid, text, text) to authenticated;

-- ---------- Row level security -------------------------------------------
alter table public.platform_incidents enable row level security;
alter table public.incident_events    enable row level security;

-- Read is open to every platform role, including finance and support: knowing
-- the platform is degraded is not privileged information among staff, and an
-- incident nobody can see is an incident that gets opened twice.
drop policy if exists platform_incidents_select on public.platform_incidents;
create policy platform_incidents_select
  on public.platform_incidents for select
  using (public.has_platform_role(
    array['platform_owner','platform_admin','platform_support','platform_finance']));

drop policy if exists incident_events_select on public.incident_events;
create policy incident_events_select
  on public.incident_events for select
  using (public.has_platform_role(
    array['platform_owner','platform_admin','platform_support','platform_finance']));

-- Deliberately NOT readable by tenants. Customer communication about an
-- incident is a written, reviewed message — not this table, which contains
-- half-formed diagnosis written at speed.
revoke insert, update, delete on public.platform_incidents from anon, authenticated;
revoke insert, update, delete on public.incident_events    from anon, authenticated;
