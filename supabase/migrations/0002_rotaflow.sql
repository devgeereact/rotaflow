-- =====================================================================
-- 0002_rotaflow.sql — RotaFlow multi-tenant domain schema + RLS
-- Additive & idempotent. Do NOT edit 0001_init.sql; this builds on it.
-- Run after 0001 in the Supabase SQL editor or via `supabase db push`.
--
-- Model: single database, many tenants. Every domain table carries org_id.
-- RLS isolates tenants via SECURITY DEFINER helpers (no policy recursion).
-- =====================================================================

-- ---------- Super Admin flag on profiles -----------------------------
alter table public.profiles
  add column if not exists is_platform_admin boolean not null default false;

-- =====================================================================
-- Tenancy core
-- =====================================================================
create table if not exists public.organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  plan        text not null default 'starter'
                check (plan in ('starter','professional','business')),
  settings    jsonb not null default '{}'::jsonb,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);

create table if not exists public.memberships (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'staff'
                check (role in ('owner','manager','staff')),
  status      text not null default 'active'
                check (status in ('invited','active','suspended')),
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now()),
  unique (org_id, user_id)
);
create index if not exists memberships_user_idx on public.memberships (user_id);
create index if not exists memberships_org_idx  on public.memberships (org_id);

-- ---------- RLS helper functions (SECURITY DEFINER, bypass RLS) ------
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  ) or public.is_platform_admin();
$$;

create or replace function public.has_org_role(p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid()
      and m.status = 'active' and m.role = any(p_roles)
  ) or public.is_platform_admin();
$$;

-- ---------- Auto-provision owner on org creation ---------------------
-- Solves the tenant bootstrap: the creator isn't an owner yet, so RLS would
-- otherwise block them from inserting their own membership. This SECURITY
-- DEFINER trigger makes the creator an active owner the moment an org is made.
create or replace function public.handle_new_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.memberships (org_id, user_id, role, status)
  values (new.id, new.created_by, 'owner', 'active')
  on conflict (org_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_org_created on public.organisations;
create trigger on_org_created
  after insert on public.organisations
  for each row when (new.created_by is not null)
  execute function public.handle_new_org();

-- NOTE: my_staff_profile_id() is defined AFTER staff_profiles exists
-- (see below), because a SQL function body is validated against referenced
-- tables at creation time.

-- =====================================================================
-- Structure: locations, departments, staff
-- =====================================================================
create table if not exists public.locations (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organisations(id) on delete cascade,
  name              text not null,
  address           text,
  latitude          double precision,
  longitude         double precision,
  timezone          text not null default 'Europe/London',
  geofence_radius_m integer not null default 150,
  created_at        timestamptz not null default timezone('utc', now()),
  updated_at        timestamptz not null default timezone('utc', now())
);
create index if not exists locations_org_idx on public.locations (org_id);

create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  name        text not null,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);
create index if not exists departments_org_idx on public.departments (org_id);

create table if not exists public.staff_profiles (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organisations(id) on delete cascade,
  user_id           uuid references public.profiles(id) on delete set null,
  first_name        text not null,
  last_name         text not null,
  job_title         text,
  department_id     uuid references public.departments(id) on delete set null,
  contract_type     text,
  weekly_hours      numeric(5,2),
  holiday_allowance numeric(6,2),
  skills            text[] not null default '{}',
  payroll_id        text,
  start_date        date,
  phone             text,
  photo_url         text,
  active            boolean not null default true,
  created_at        timestamptz not null default timezone('utc', now()),
  updated_at        timestamptz not null default timezone('utc', now())
);
create index if not exists staff_profiles_org_idx  on public.staff_profiles (org_id);
create index if not exists staff_profiles_user_idx on public.staff_profiles (user_id);

-- ---------- deferred helper (needs staff_profiles) -------------------
create or replace function public.my_staff_profile_id(p_org uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select sp.id from public.staff_profiles sp
  where sp.org_id = p_org and sp.user_id = auth.uid()
  limit 1;
$$;

-- =====================================================================
-- Shifts: types, templates, rotas, shifts
-- =====================================================================
create table if not exists public.shift_types (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations(id) on delete cascade,
  name          text not null,
  colour        text not null default '#2563eb',
  default_start time,
  default_end   time,
  is_paid       boolean not null default true,
  category      text,
  created_at    timestamptz not null default timezone('utc', now()),
  updated_at    timestamptz not null default timezone('utc', now())
);
create index if not exists shift_types_org_idx on public.shift_types (org_id);

create table if not exists public.shift_templates (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organisations(id) on delete cascade,
  name           text not null,
  shift_type_id  uuid references public.shift_types(id) on delete set null,
  location_id    uuid references public.locations(id) on delete set null,
  department_id  uuid references public.departments(id) on delete set null,
  start_time     time not null,
  end_time       time not null,
  break_minutes  integer not null default 0,
  required_skills text[] not null default '{}',
  created_at     timestamptz not null default timezone('utc', now()),
  updated_at     timestamptz not null default timezone('utc', now())
);
create index if not exists shift_templates_org_idx on public.shift_templates (org_id);

create table if not exists public.rotas (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations(id) on delete cascade,
  location_id   uuid references public.locations(id) on delete set null,
  name          text not null,
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'draft' check (status in ('draft','published')),
  published_at  timestamptz,
  created_at    timestamptz not null default timezone('utc', now()),
  updated_at    timestamptz not null default timezone('utc', now())
);
create index if not exists rotas_org_idx on public.rotas (org_id);

create table if not exists public.shifts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organisations(id) on delete cascade,
  rota_id          uuid references public.rotas(id) on delete set null,
  location_id      uuid references public.locations(id) on delete set null,
  department_id    uuid references public.departments(id) on delete set null,
  staff_profile_id uuid references public.staff_profiles(id) on delete set null,
  shift_type_id    uuid references public.shift_types(id) on delete set null,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  break_minutes    integer not null default 0,
  status           text not null default 'open'
                     check (status in ('open','assigned','confirmed','cancelled')),
  colour           text,
  notes            text,
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);
create index if not exists shifts_org_idx    on public.shifts (org_id);
create index if not exists shifts_rota_idx   on public.shifts (rota_id);
create index if not exists shifts_staff_idx  on public.shifts (staff_profile_id);
create index if not exists shifts_starts_idx on public.shifts (starts_at);

-- =====================================================================
-- Staff-driven records
-- =====================================================================
create table if not exists public.availability (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organisations(id) on delete cascade,
  staff_profile_id uuid not null references public.staff_profiles(id) on delete cascade,
  weekday          integer check (weekday between 0 and 6),
  date             date,
  start_time       time,
  end_time         time,
  status           text not null default 'available'
                     check (status in ('available','unavailable','preferred')),
  recurring        boolean not null default false,
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);
create index if not exists availability_org_idx   on public.availability (org_id);
create index if not exists availability_staff_idx on public.availability (staff_profile_id);

create table if not exists public.leave_requests (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organisations(id) on delete cascade,
  staff_profile_id uuid not null references public.staff_profiles(id) on delete cascade,
  type             text not null default 'holiday',
  start_date       date not null,
  end_date         date not null,
  status           text not null default 'pending'
                     check (status in ('pending','approved','rejected','cancelled')),
  reason           text,
  reviewed_by      uuid references public.profiles(id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);
create index if not exists leave_org_idx   on public.leave_requests (org_id);
create index if not exists leave_staff_idx on public.leave_requests (staff_profile_id);

create table if not exists public.overtime_requests (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organisations(id) on delete cascade,
  staff_profile_id uuid not null references public.staff_profiles(id) on delete cascade,
  date             date not null,
  hours            numeric(5,2) not null,
  status           text not null default 'pending'
                     check (status in ('pending','approved','rejected')),
  note             text,
  reviewed_by      uuid references public.profiles(id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);
create index if not exists overtime_org_idx   on public.overtime_requests (org_id);
create index if not exists overtime_staff_idx on public.overtime_requests (staff_profile_id);

create table if not exists public.shift_swaps (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organisations(id) on delete cascade,
  shift_id               uuid not null references public.shifts(id) on delete cascade,
  requested_by           uuid not null references public.staff_profiles(id) on delete cascade,
  target_staff_profile_id uuid references public.staff_profiles(id) on delete set null,
  status                 text not null default 'pending'
                           check (status in ('pending','accepted','approved','rejected','cancelled')),
  note                   text,
  reviewed_by            uuid references public.profiles(id) on delete set null,
  reviewed_at            timestamptz,
  created_at             timestamptz not null default timezone('utc', now()),
  updated_at             timestamptz not null default timezone('utc', now())
);
create index if not exists swaps_org_idx   on public.shift_swaps (org_id);
create index if not exists swaps_shift_idx on public.shift_swaps (shift_id);

create table if not exists public.clock_events (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organisations(id) on delete cascade,
  staff_profile_id uuid not null references public.staff_profiles(id) on delete cascade,
  shift_id         uuid references public.shifts(id) on delete set null,
  type             text not null check (type in ('in','out','break_start','break_end')),
  event_at         timestamptz not null default timezone('utc', now()),
  latitude         double precision,
  longitude        double precision,
  accuracy         double precision,
  method           text not null default 'manual' check (method in ('gps','qr','manual')),
  location_name    text,
  synced           boolean not null default true,
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);
create index if not exists clock_org_idx   on public.clock_events (org_id);
create index if not exists clock_staff_idx on public.clock_events (staff_profile_id);
create index if not exists clock_event_at_idx on public.clock_events (event_at);

create table if not exists public.timesheets (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organisations(id) on delete cascade,
  staff_profile_id uuid not null references public.staff_profiles(id) on delete cascade,
  period_start     date not null,
  period_end       date not null,
  total_minutes    integer not null default 0,
  status           text not null default 'open'
                     check (status in ('open','submitted','approved','exported')),
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);
create index if not exists timesheets_org_idx   on public.timesheets (org_id);
create index if not exists timesheets_staff_idx on public.timesheets (staff_profile_id);

create table if not exists public.emergency_contacts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organisations(id) on delete cascade,
  staff_profile_id uuid not null references public.staff_profiles(id) on delete cascade,
  name             text not null,
  relationship     text,
  phone            text not null,
  secondary_phone  text,
  medical_notes    text,
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);
create index if not exists emergency_org_idx   on public.emergency_contacts (org_id);
create index if not exists emergency_staff_idx on public.emergency_contacts (staff_profile_id);

create table if not exists public.documents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organisations(id) on delete cascade,
  staff_profile_id uuid not null references public.staff_profiles(id) on delete cascade,
  type             text not null,
  name             text not null,
  file_url         text not null,
  issued_at        date,
  expires_at       date,
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);
create index if not exists documents_org_idx   on public.documents (org_id);
create index if not exists documents_staff_idx on public.documents (staff_profile_id);
create index if not exists documents_expiry_idx on public.documents (expires_at);

-- =====================================================================
-- Communication, billing, audit
-- =====================================================================
create table if not exists public.announcements (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organisations(id) on delete cascade,
  author_user_id uuid references public.profiles(id) on delete set null,
  scope          text not null default 'org' check (scope in ('org','location','department')),
  location_id    uuid references public.locations(id) on delete set null,
  department_id  uuid references public.departments(id) on delete set null,
  title          text not null,
  body           text not null,
  urgent         boolean not null default false,
  published_at   timestamptz,
  created_at     timestamptz not null default timezone('utc', now()),
  updated_at     timestamptz not null default timezone('utc', now())
);
create index if not exists announcements_org_idx on public.announcements (org_id);

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text,
  -- 'sms' is a RESERVED channel value — not delivered in V1.
  channel     text not null default 'push' check (channel in ('push','email','sms')),
  read_at     timestamptz,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);
create index if not exists notifications_org_idx  on public.notifications (org_id);
create index if not exists notifications_user_idx on public.notifications (user_id);

create table if not exists public.subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null unique references public.organisations(id) on delete cascade,
  plan               text not null default 'starter'
                       check (plan in ('starter','professional','business')),
  status             text not null default 'trialing'
                       check (status in ('trialing','active','past_due','canceled')),
  -- Pluggable provider (apple_pay | google_pay | paypal | ...). Charging built last.
  provider           text,
  provider_ref       text,
  current_period_end timestamptz,
  created_at         timestamptz not null default timezone('utc', now()),
  updated_at         timestamptz not null default timezone('utc', now())
);

create table if not exists public.audit_logs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organisations(id) on delete cascade,
  actor_user_id  uuid references public.profiles(id) on delete set null,
  action         text not null,
  entity_type    text,
  entity_id      uuid,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default timezone('utc', now())
);
create index if not exists audit_org_idx on public.audit_logs (org_id);

-- =====================================================================
-- updated_at triggers for every table with an updated_at column
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'organisations','memberships','locations','departments','staff_profiles',
    'shift_types','shift_templates','rotas','shifts','availability','leave_requests',
    'overtime_requests','shift_swaps','clock_events','timesheets','emergency_contacts',
    'documents','announcements','notifications','subscriptions'
  ]
  loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I;', t, t);
    execute format(
      'create trigger %I_set_updated_at before update on public.%I
         for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;

-- =====================================================================
-- Enable RLS on every table
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'organisations','memberships','locations','departments','staff_profiles',
    'shift_types','shift_templates','rotas','shifts','availability','leave_requests',
    'overtime_requests','shift_swaps','clock_events','timesheets','emergency_contacts',
    'documents','announcements','notifications','subscriptions','audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- =====================================================================
-- Policies
-- Helper pattern:
--   org-shared read  = is_org_member(org_id)
--   management write = has_org_role(org_id, array['owner','manager'])
--   personal rows    = staff_profile_id = my_staff_profile_id(org_id)
-- =====================================================================

-- ---- organisations ---------------------------------------------------
drop policy if exists organisations_select on public.organisations;
create policy organisations_select on public.organisations for select
  using (public.is_org_member(id));
drop policy if exists organisations_insert on public.organisations;
create policy organisations_insert on public.organisations for insert
  with check (auth.uid() = created_by);           -- creator bootstraps; add self as owner in app
drop policy if exists organisations_update on public.organisations;
create policy organisations_update on public.organisations for update
  using (public.has_org_role(id, array['owner']))
  with check (public.has_org_role(id, array['owner']));

-- ---- memberships (owners manage the team) ---------------------------
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select
  using (public.is_org_member(org_id) or user_id = auth.uid());
drop policy if exists memberships_write on public.memberships;
create policy memberships_write on public.memberships for all
  using (public.has_org_role(org_id, array['owner']))
  with check (public.has_org_role(org_id, array['owner']));

-- ---- org-shared tables: member read, manager/owner write ------------
do $$
declare t text;
begin
  foreach t in array array[
    'locations','departments','staff_profiles','shift_types','shift_templates',
    'rotas','shifts','announcements'
  ]
  loop
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format(
      'create policy %I_select on public.%I for select using (public.is_org_member(org_id));',
      t, t);
    execute format('drop policy if exists %I_write on public.%I;', t, t);
    execute format(
      'create policy %I_write on public.%I for all
         using (public.has_org_role(org_id, array[''owner'',''manager'']))
         with check (public.has_org_role(org_id, array[''owner'',''manager'']));',
      t, t);
  end loop;
end $$;

-- ---- personal tables: staff own rows; managers/owners all in org ----
do $$
declare t text;
begin
  foreach t in array array[
    'availability','leave_requests','overtime_requests','clock_events',
    'emergency_contacts','documents','timesheets'
  ]
  loop
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format(
      'create policy %I_select on public.%I for select
         using (staff_profile_id = public.my_staff_profile_id(org_id)
                or public.has_org_role(org_id, array[''owner'',''manager'']));',
      t, t);
    execute format('drop policy if exists %I_write on public.%I;', t, t);
    execute format(
      'create policy %I_write on public.%I for all
         using (staff_profile_id = public.my_staff_profile_id(org_id)
                or public.has_org_role(org_id, array[''owner'',''manager'']))
         with check (staff_profile_id = public.my_staff_profile_id(org_id)
                or public.has_org_role(org_id, array[''owner'',''manager'']));',
      t, t);
  end loop;
end $$;

-- ---- shift_swaps: involved staff + managers -------------------------
drop policy if exists shift_swaps_select on public.shift_swaps;
create policy shift_swaps_select on public.shift_swaps for select
  using (requested_by = public.my_staff_profile_id(org_id)
         or target_staff_profile_id = public.my_staff_profile_id(org_id)
         or public.has_org_role(org_id, array['owner','manager']));
drop policy if exists shift_swaps_write on public.shift_swaps;
create policy shift_swaps_write on public.shift_swaps for all
  using (requested_by = public.my_staff_profile_id(org_id)
         or public.has_org_role(org_id, array['owner','manager']))
  with check (requested_by = public.my_staff_profile_id(org_id)
         or public.has_org_role(org_id, array['owner','manager']));

-- ---- notifications: own rows ----------------------------------------
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select
  using (user_id = auth.uid() or public.is_platform_admin());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- inserts are performed by Edge Functions (service role) — no client insert policy.

-- ---- subscriptions + audit_logs: owners/admin read only -------------
drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions for select
  using (public.has_org_role(org_id, array['owner']));
-- writes to subscriptions come from billing Edge Functions (service role).

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select
  using (public.has_org_role(org_id, array['owner']));
-- audit_logs are append-only from the server (service role); no client write policy.

-- =====================================================================
-- done — 0002_rotaflow.sql
-- =====================================================================
