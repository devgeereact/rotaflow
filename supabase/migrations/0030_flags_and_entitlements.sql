-- =====================================================================
-- 0030. Flags that gate something, entitlements that live on the plan
--
-- 0022 created six feature flags and the console has been toggling them since.
-- `flag_enabled_for_org()` was never called by the application, so turning off
-- "GPS clock-in" turned off nothing. A control that looks live and does nothing
-- is worse than no control.
--
-- ## The distinction this migration draws
--
-- Two of the six are genuinely flags: work that ships dark and is rolled out by
-- percentage, then either becomes permanent or is removed. `ai_rota_assistant`
-- and `beta_integrations` stay, and the application now asks before rendering
-- either.
--
-- The other four were never flags. "GPS clock-in" and "Advanced reporting" are
-- what a customer is paying for, "New rota builder" is a migration that has
-- either happened or not, and "Shift swap automation" was off for everyone.
-- Entitlements belong on `plans`, beside the price that buys them, where the
-- upgrade screen can read them and a rollout percentage cannot accidentally
-- take a paid feature away from a paying customer.
--
-- ## Why the flags are not simply deleted
--
-- `feature_flag_changes` references them and is a record of who changed what.
-- The rows are marked retired instead, so the history survives and the console
-- stops offering a switch.
-- =====================================================================

-- ---------- Entitlements, on the plan -----------------------------------
alter table public.plans
  add column if not exists features text[] not null default '{}';

comment on column public.plans.features is
  'What this plan includes. Read by entitlement checks and by the upgrade screen, so the list a customer is sold and the list the product enforces are the same array.';

update public.plans set features = array['gps_clock_in']
 where code = 'starter';
update public.plans set features = array['gps_clock_in','advanced_reporting']
 where code = 'professional';
update public.plans set features = array['gps_clock_in','advanced_reporting','ai_rota_assistant']
 where code in ('business','enterprise');

-- Does this organisation's plan include the feature?
--
-- Separate from `flag_enabled_for_org` on purpose. An entitlement is a
-- commercial fact that changes when someone upgrades; a flag is a release
-- decision that changes when engineering says so. Collapsing them is how a
-- rollout percentage ends up removing something a customer paid for.
create or replace function public.org_has_feature(p_org uuid, p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p_feature = any (pl.features)
       from public.organisations o
       join public.plans pl on pl.code = o.plan
      where o.id = p_org),
    false);
$$;

comment on function public.org_has_feature(uuid, text) is
  'Plan entitlement, not a feature flag. True when the organisation''s plan lists the feature.';

grant execute on function public.org_has_feature(uuid, text) to authenticated;

-- ---------- Retire the four that were never flags -----------------------
alter table public.feature_flags
  add column if not exists retired_at timestamptz,
  add column if not exists retired_reason text;

comment on column public.feature_flags.retired_at is
  'Set when a flag stops being offered. The row stays so feature_flag_changes keeps its referent.';

update public.feature_flags
   set enabled = false,
       rollout = 0,
       retired_at = timezone('utc', now()),
       retired_reason = case key
         when 'gps_clock_in'
           then 'A plan entitlement, not a release toggle. Moved to plans.features.'
         when 'advanced_reporting'
           then 'A plan entitlement, not a release toggle. Moved to plans.features.'
         when 'new_rota_builder'
           then 'A migration rather than a feature: the grid has either shipped or it has not.'
         when 'shift_swap_automation'
           then 'Never enabled for anyone, and auto-approving a swap is a tenant setting rather than a platform one.'
         else retired_reason end
 where key in ('gps_clock_in','advanced_reporting','new_rota_builder','shift_swap_automation');

insert into public.feature_flag_changes
  (flag_key, actor_name, field, before_value, after_value)
select key, 'Migration 0030', 'enabled', 'true', 'retired'
  from public.feature_flags
 where retired_at is not null;

-- A retired flag must not be re-enabled from the console by accident.
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
  if f.retired_at is not null then
    raise exception 'Flag % was retired: %', p_key, coalesce(f.retired_reason, 'no reason recorded')
      using errcode = '22023';
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

-- ---------- Everything this session is entitled to, in one call ---------
-- The application asks once per organisation load rather than once per gate.
-- Six round trips to render one screen is how a feature check becomes the
-- thing everyone disables.
create or replace function public.my_feature_access(p_org uuid)
returns table (feature text, source text)
language sql stable security definer set search_path = public as $$
  select f.key, 'flag'::text
    from public.feature_flags f
   where f.retired_at is null
     and public.flag_enabled_for_org(f.key, p_org)
  union
  select unnest(pl.features), 'plan'::text
    from public.organisations o
    join public.plans pl on pl.code = o.plan
   where o.id = p_org;
$$;

comment on function public.my_feature_access(uuid) is
  'Every feature this organisation can use, and whether a flag or its plan grants it. One call per organisation load.';

grant execute on function public.my_feature_access(uuid) to authenticated;
