-- =====================================================================
-- 0036 — Minimum cover rules
--
-- Every site's staffing minimum, by day of week. The rota builder and the
-- manager dashboard both need to say "Tuesday is two people short of the
-- minimum" — today neither can, because there is nowhere in the schema for
-- a manager to say what the minimum *is*. Settings → Policies deliberately
-- stopped short of this (see SettingsPoliciesPage.tsx): a policy *engine*
-- was out of scope, but a per-site number a manager sets once is not one.
--
-- ## Why per-location, not one number for the organisation
--
-- Docs/SCHEMA.md's shared-scheduling tables are all scoped to a location for
-- the same reason: a five-site organisation does not have one staffing
-- minimum, it has five, and conflating them would either nag a fully-covered
-- site about a shortfall at a different one, or hide a real shortfall behind
-- a healthy sitewide average.
--
-- ## Why weekday, not a date
--
-- The minimum is a standing policy ("Saturdays need 5"), not a one-off. A
-- `weekday` row set once covers every future week; a `date` row would need
-- resetting every week it repeats. `availability.weekday` already uses
-- Postgres' 0=Sunday convention (see src/lib/rotaInsights.ts), so this
-- matches it rather than inventing a second convention for the client to
-- reconcile.
--
-- ## Conflict evaluation stays client-side
--
-- Per docs/SCHEMA.md §5, conflict/summary logic is computed in the client
-- for V1. This migration only stores the policy value; src/lib/rotaInsights.ts
-- reads it alongside `shifts` to compute the gap, the same pattern every
-- other insight in that file already follows.
-- =====================================================================

create table if not exists public.minimum_cover_rules (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,

  -- 0=Sunday..6=Saturday, matching availability.weekday.
  weekday     smallint not null check (weekday between 0 and 6),
  min_staff   integer not null default 0 check (min_staff >= 0),

  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now()),

  -- One rule per site per weekday. Upserted, never duplicated.
  unique (location_id, weekday)
);

comment on table public.minimum_cover_rules is
  'One site''s staffing minimum for one day of the week. Read by the client alongside shifts to compute cover gaps; nothing here blocks a rota from being saved.';

create index if not exists minimum_cover_rules_org_idx
  on public.minimum_cover_rules (org_id);

drop trigger if exists minimum_cover_rules_set_updated_at on public.minimum_cover_rules;
create trigger minimum_cover_rules_set_updated_at
  before update on public.minimum_cover_rules
  for each row execute function public.set_updated_at();

-- ---------- Row level security -----------------------------------------
-- Same shape as every other shared-scheduling table (0002_rotaflow.sql):
-- any member reads, owner/manager writes.
alter table public.minimum_cover_rules enable row level security;

drop policy if exists minimum_cover_rules_select on public.minimum_cover_rules;
create policy minimum_cover_rules_select
  on public.minimum_cover_rules for select
  using (public.is_org_member(org_id));

drop policy if exists minimum_cover_rules_write on public.minimum_cover_rules;
create policy minimum_cover_rules_write
  on public.minimum_cover_rules for all
  using (public.has_org_role(org_id, array['owner','manager']))
  with check (public.has_org_role(org_id, array['owner','manager']));
