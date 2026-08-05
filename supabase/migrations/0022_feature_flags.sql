-- =====================================================================
-- 0022 — Feature flags
--
-- Ship behind a flag, roll out by percentage, turn it off without a deploy.
-- The console has shown this screen with invented rows; this is the store.
--
-- ## Why the rollout is a percentage and not a list
--
-- A staged rollout has to be stable: the same organisation must land on the
-- same side of the line on every render, or a manager sees a feature appear
-- and vanish between page loads. `flag_enabled_for_org()` hashes the flag key
-- with the organisation id, so the answer is deterministic per pair and a
-- rollout raised from 10% to 20% only ever *adds* organisations.
--
-- Target plans and explicitly targeted organisations are separate from the
-- percentage and are checked first — "everyone on Enterprise, plus these two
-- pilots, plus 20% of the rest" is the real shape of a rollout.
--
-- ## Why the history is a table and not the audit log
--
-- Both. The audit log records that someone changed a flag, because that is a
-- platform action and belongs in the immutable record. `feature_flag_changes`
-- records what the value was before and after in a shape the flag screen can
-- read back without parsing audit metadata.
-- =====================================================================

create table if not exists public.feature_flags (
  -- The key is the primary key: it is what code checks, it never changes, and
  -- a surrogate id would let two rows claim the same key.
  key           text primary key
                  check (key ~ '^[a-z][a-z0-9_]{2,63}$'),

  name          text not null check (length(btrim(name)) > 0),
  description   text not null default '',

  enabled       boolean not null default false,

  -- 0–100. Only consulted when `enabled`; a disabled flag is off for everyone
  -- regardless of what the slider says, which is what makes the switch a kill
  -- switch rather than one more input to reason about.
  rollout       integer not null default 0 check (rollout between 0 and 100),

  environment   text not null default 'production'
                  check (environment in ('production','staging','development')),

  -- Marks a flag that changes live tenant behaviour. The console requires a
  -- re-authentication before changing one of these; the flag itself only has
  -- to say which ones they are.
  critical      boolean not null default false,

  -- Plans that get the feature outright, ahead of the percentage.
  target_plans  text[] not null default '{}',

  created_at    timestamptz not null default timezone('utc', now()),
  updated_at    timestamptz not null default timezone('utc', now()),
  updated_by    uuid references public.profiles(id) on delete set null
);

comment on table public.feature_flags is
  'Product feature flags with a stable percentage rollout. Read by every authenticated session; written only by platform config roles.';

-- Organisations targeted by name, ahead of the percentage. A pilot list.
create table if not exists public.feature_flag_targets (
  flag_key   text not null references public.feature_flags(key) on delete cascade,
  org_id     uuid not null references public.organisations(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (flag_key, org_id)
);

comment on table public.feature_flag_targets is
  'Organisations that receive a flag regardless of its rollout percentage.';

create table if not exists public.feature_flag_changes (
  id         uuid primary key default gen_random_uuid(),
  flag_key   text not null references public.feature_flags(key) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  actor_name text,
  field      text not null check (field in ('enabled','rollout','target_plans','targets','created')),
  before_value text,
  after_value  text,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.feature_flag_changes is
  'What a flag was before and after each change, in the shape the console reads back as History.';

create index if not exists feature_flag_changes_flag_idx
  on public.feature_flag_changes (flag_key, created_at desc);

drop trigger if exists feature_flags_set_updated_at on public.feature_flags;
create trigger feature_flags_set_updated_at
  before update on public.feature_flags
  for each row execute function public.set_updated_at();

-- ---------- Is this flag on, for this organisation? --------------------
-- STABLE, not VOLATILE: the planner may cache it within a statement, and the
-- whole point is that the answer does not move.
create or replace function public.flag_enabled_for_org(p_key text, p_org uuid)
returns boolean language sql stable set search_path = public as $$
  select case
    when f.key is null then false
    when not f.enabled then false
    when f.rollout >= 100 then true
    when exists (select 1 from public.feature_flag_targets t
                  where t.flag_key = f.key and t.org_id = p_org) then true
    when o.plan = any (f.target_plans) then true
    when f.rollout <= 0 then false
    -- Deterministic bucket in [0,99] from the flag key and the organisation.
    -- Hashing both together means two flags at 20% do not select the same 20%
    -- of tenants, which would make every staged rollout land on the same
    -- unlucky customers.
    else (abs(hashtext(f.key || ':' || p_org::text)) % 100) < f.rollout
  end
  from public.feature_flags f
  left join public.organisations o on o.id = p_org
  where f.key = p_key;
$$;

comment on function public.flag_enabled_for_org(text, uuid) is
  'Stable per (flag, organisation): raising a rollout only ever adds organisations.';

grant execute on function public.flag_enabled_for_org(text, uuid) to authenticated;

-- ---------- Change one --------------------------------------------------
create or replace function public.set_feature_flag(
  p_key      text,
  p_enabled  boolean default null,
  p_rollout  integer default null,
  p_plans    text[] default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  f public.feature_flags;
  v_name text;
begin
  if not public.has_platform_role(array['platform_owner','platform_admin']) then
    raise exception 'Only a platform owner or administrator can change a feature flag'
      using errcode = '42501';
  end if;

  select * into f from public.feature_flags where key = p_key;
  if not found then
    raise exception 'No feature flag with key %', p_key using errcode = 'P0002';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();

  if p_enabled is not null and p_enabled is distinct from f.enabled then
    insert into public.feature_flag_changes
      (flag_key, actor_id, actor_name, field, before_value, after_value)
    values (p_key, auth.uid(), v_name, 'enabled', f.enabled::text, p_enabled::text);
  end if;

  if p_rollout is not null and p_rollout is distinct from f.rollout then
    insert into public.feature_flag_changes
      (flag_key, actor_id, actor_name, field, before_value, after_value)
    values (p_key, auth.uid(), v_name, 'rollout', f.rollout || '%', p_rollout || '%');
  end if;

  if p_plans is not null and p_plans is distinct from f.target_plans then
    insert into public.feature_flag_changes
      (flag_key, actor_id, actor_name, field, before_value, after_value)
    values (p_key, auth.uid(), v_name, 'target_plans',
            array_to_string(f.target_plans, ', '), array_to_string(p_plans, ', '));
  end if;

  update public.feature_flags
     set enabled      = coalesce(p_enabled, enabled),
         rollout      = coalesce(p_rollout, rollout),
         target_plans = coalesce(p_plans, target_plans),
         updated_by   = auth.uid()
   where key = p_key;

  perform public.audit_write(
    null, 'feature_flag.updated', 'feature_flag', null,
    jsonb_build_object(
      'key', p_key,
      'before', case when p_enabled is not null then f.enabled::text else f.rollout || '%' end,
      'after',  case when p_enabled is not null then p_enabled::text
                     else coalesce(p_rollout, f.rollout) || '%' end),
    case when f.critical then 'warning' else 'notice' end,
    'platform_only');
end;
$$;

revoke all on function public.set_feature_flag(text, boolean, integer, text[])
  from public, anon;
grant execute on function public.set_feature_flag(text, boolean, integer, text[])
  to authenticated;

-- ---------- Target one organisation ------------------------------------
create or replace function public.set_feature_flag_target(
  p_key      text,
  p_org      uuid,
  p_targeted boolean
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_org  text;
begin
  if not public.has_platform_role(array['platform_owner','platform_admin']) then
    raise exception 'Only a platform owner or administrator can target a feature flag'
      using errcode = '42501';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  select name into v_org from public.organisations where id = p_org;
  if v_org is null then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;

  if p_targeted then
    insert into public.feature_flag_targets (flag_key, org_id)
    values (p_key, p_org)
    on conflict do nothing;
  else
    delete from public.feature_flag_targets where flag_key = p_key and org_id = p_org;
  end if;

  insert into public.feature_flag_changes
    (flag_key, actor_id, actor_name, field, before_value, after_value)
  values (p_key, auth.uid(), v_name, 'targets',
          case when p_targeted then 'not targeted' else v_org end,
          case when p_targeted then v_org else 'not targeted' end);

  perform public.audit_write(
    p_org, 'feature_flag.targeted', 'feature_flag', null,
    jsonb_build_object('key', p_key, 'before', (not p_targeted)::text, 'after', p_targeted::text),
    'notice', 'platform_only');
end;
$$;

revoke all on function public.set_feature_flag_target(text, uuid, boolean) from public, anon;
grant execute on function public.set_feature_flag_target(text, uuid, boolean) to authenticated;

-- ---------- Row level security -----------------------------------------
alter table public.feature_flags        enable row level security;
alter table public.feature_flag_targets enable row level security;
alter table public.feature_flag_changes enable row level security;

-- Every signed-in session reads the flags: the tenant app has to know what it
-- may render. Reading which features exist is not sensitive; changing one is.
drop policy if exists feature_flags_select on public.feature_flags;
create policy feature_flags_select
  on public.feature_flags for select
  using (auth.uid() is not null);

drop policy if exists feature_flag_targets_select on public.feature_flag_targets;
create policy feature_flag_targets_select
  on public.feature_flag_targets for select
  using (public.is_platform_admin() or public.is_org_member(org_id));

-- History is a platform-staff view. A tenant owner has no use for who at
-- RotaFlow moved a slider.
drop policy if exists feature_flag_changes_select on public.feature_flag_changes;
create policy feature_flag_changes_select
  on public.feature_flag_changes for select
  using (public.is_platform_admin());

revoke insert, update, delete on public.feature_flags        from anon, authenticated;
revoke insert, update, delete on public.feature_flag_targets from anon, authenticated;
revoke insert, update, delete on public.feature_flag_changes from anon, authenticated;

-- ---------- The flags this product actually has ------------------------
-- Seeded here rather than in a seed script: code checks these keys by name, so
-- a deployment without the rows is a deployment where every gated feature is
-- silently off. `on conflict do nothing` keeps a re-run from resetting a
-- rollout someone has since changed.
insert into public.feature_flags (key, name, description, enabled, rollout, environment, critical, target_plans)
values
  ('ai_rota_assistant', 'AI rota assistant',
   'Draft-rota suggestions from the OpenRouter edge function.',
   true, 35, 'production', true, array['business','enterprise']),
  ('advanced_reporting', 'Advanced reporting',
   'Cost, coverage and absence analytics beyond the standard pack.',
   true, 100, 'production', false, array['professional','business','enterprise']),
  ('gps_clock_in', 'GPS clock-in',
   'Geofenced attendance capture on the staff PWA.',
   true, 100, 'production', true, array['starter','professional','business','enterprise']),
  ('shift_swap_automation', 'Shift swap automation',
   'Auto-approve swaps that break no rule and no cost ceiling.',
   false, 0, 'production', false, array['enterprise']),
  ('new_rota_builder', 'New rota builder',
   'Rebuilt drag-and-drop grid with keyboard-first editing.',
   true, 12, 'production', true, array[]::text[]),
  ('beta_integrations', 'Beta integrations',
   'Unreleased payroll and HR connectors.',
   false, 0, 'staging', false, array[]::text[])
on conflict (key) do nothing;

insert into public.feature_flag_changes (flag_key, actor_name, field, before_value, after_value)
select key, 'Migration 0022', 'created', null, enabled::text
  from public.feature_flags
 where not exists (
   select 1 from public.feature_flag_changes c where c.flag_key = feature_flags.key);
