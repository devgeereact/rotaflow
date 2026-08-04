-- =====================================================================
-- 0018_platform_settings.sql — deployment-wide configuration
-- Additive & idempotent.
--
-- ## Why not `app_settings`
--
-- The name is misleading: `app_settings` (0001) is keyed `user_id unique` and
-- holds one person's theme and notification preference. It is per-user, not
-- per-deployment, and reusing it would mean either a nullable `user_id` on a
-- table whose whole RLS policy is `auth.uid() = user_id`, or a magic row. Both
-- are the kind of shortcut that reads fine today and is indefensible the first
-- time someone has to reason about the policy.
--
-- ## Why a singleton rather than a key/value table
--
-- Key/value defers the schema forever: every read becomes a lookup returning
-- text that some caller parses, and nothing ever tells you the set of valid
-- keys. A single row with real typed columns means the generated types name
-- every setting, a typo is a compile error, and CHECK constraints hold the
-- values. Adding a setting is one `add column if not exists`, which is what
-- every other table here already does.
-- =====================================================================

create table if not exists public.platform_settings (
  -- Enforced singleton: the CHECK admits exactly one row, so "the settings"
  -- is a `.single()` and never a "which row won?" question.
  id                     boolean primary key default true check (id),

  platform_name          text not null default 'RotaFlow',
  support_email          text not null default 'support@rotaflow.app',
  platform_url           text not null default 'https://rota.gakinz.com',
  default_timezone       text not null default 'Europe/London',

  -- Registration and verification are read by the sign-up screen; they are
  -- reported by the console rather than enforced by it, because Supabase Auth
  -- owns both and this table cannot override it. The console says which is
  -- which — see the note on `maintenance_mode` below.
  registration_enabled   boolean not null default true,

  -- A banner, not a kill switch. Nothing in a static PWA can refuse to serve
  -- itself, and RLS is what actually stands between a user and the data. A
  -- "maintenance mode" that only hid the UI would be a lie told to the honest
  -- half of the userbase.
  maintenance_mode       boolean not null default false,
  maintenance_message    text,

  updated_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default timezone('utc', now()),
  updated_at             timestamptz not null default timezone('utc', now())
);

drop trigger if exists platform_settings_set_updated_at on public.platform_settings;
create trigger platform_settings_set_updated_at
  before update on public.platform_settings
  for each row execute function public.set_updated_at();

-- The row must exist before anything reads it, or every screen has to handle
-- "no settings yet" as a distinct state from "settings at their defaults".
insert into public.platform_settings (id) values (true)
on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

-- Readable by every signed-in user: the maintenance banner and the support
-- address are things the tenant app needs to show. Nothing sensitive lives
-- here, and anything that later does belongs in a separate table rather than
-- behind a narrowed policy on this one.
drop policy if exists platform_settings_select on public.platform_settings;
create policy platform_settings_select
  on public.platform_settings for select
  using (auth.uid() is not null);

-- Writes are owner/admin only. `for update` rather than `for all`: there is
-- exactly one row and it is seeded above, so nothing should ever insert or
-- delete here, and not granting those is how that stays true.
drop policy if exists platform_settings_update on public.platform_settings;
create policy platform_settings_update
  on public.platform_settings for update
  using      (public.has_platform_role(array['platform_owner','platform_admin']))
  with check (public.has_platform_role(array['platform_owner','platform_admin']));
