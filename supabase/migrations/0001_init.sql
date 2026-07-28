-- =====================================================================
-- 0001_init.sql — profiles + app_settings, RLS, and auto-provisioning
-- Run in the Supabase SQL editor or via `supabase db push`.
-- Safe to re-run: guarded with "if not exists" / "drop ... if exists".
-- =====================================================================

-- ---------- Tables ----------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text unique not null,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);

create table if not exists public.app_settings (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique
                          references public.profiles(id) on delete cascade,
  theme                 text not null default 'dark'
                          check (theme in ('dark', 'light')),
  notifications_enabled boolean not null default true,
  created_at            timestamptz not null default timezone('utc', now()),
  updated_at            timestamptz not null default timezone('utc', now())
);

create index if not exists app_settings_user_id_idx
  on public.app_settings (user_id);

-- ---------- Row Level Security ---------------------------------------
alter table public.profiles      enable row level security;
alter table public.app_settings  enable row level security;

-- profiles: a user only touches their own row
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- app_settings: full control over own row only
drop policy if exists "app_settings_all_own" on public.app_settings;
create policy "app_settings_all_own"
  on public.app_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------- updated_at maintenance -----------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- ---------- Auto-provision on sign-up --------------------------------
-- Creates the profile + default settings whenever a new auth user appears,
-- so the app never has to handle "missing profile" states.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.app_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
