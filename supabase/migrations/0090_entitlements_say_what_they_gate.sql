-- =====================================================================
-- 0090_entitlements_say_what_they_gate.sql — an entitlement that gates
-- nothing stops being an entitlement (docs/SAAS.md BUG-064)
--
-- CAP-038 gated `ai_rota_assistant`, which is the one that costs money
-- per use. The other three were left, and BUG-064 recorded why: gating
-- each was a product decision that change had no basis to make. Made
-- now, one at a time, because `plans.features` listing things nothing
-- checks is worse than a shorter list — it reads as enforcement to the
-- next person, and it is what a customer is shown on the upgrade screen.
--
-- ## gps_clock_in — REMOVED, because it is not an entitlement
--
-- Every plan has it, starter included, and the pricing page sells "GPS
-- clock-in with offline queue" as a Starter line. A gate on something
-- every plan includes cannot ever refuse anything; it is a no-op that
-- reads as a control. So it stops being a feature flag and a plan
-- feature and goes back to being what it is: part of the product.
--
-- Removing it from `plans.features` deliberately makes
-- `org_has_feature(org, 'gps_clock_in')` return FALSE. Nothing calls it
-- — that is the point of this migration — and a name that resolves to
-- "false" is a better trap than one that resolves to "true for
-- everyone", because the first fails visibly the moment somebody wires
-- it up by mistake.
--
-- ## beta_integrations — RETIRED, because it describes nothing
--
-- "Unreleased payroll and HR connectors." The only integration a tenant
-- can reach is their own SMTP, and every platform connector was marked
-- `planned` in 0073. The flag has been `false` at 0% in `staging` since
-- 0022 and gates no code path. 0030 retired the other three flags that
-- had become entitlements; this one was missed because it never became
-- anything at all.
--
-- ## advanced_reporting — KEPT, and now actually gates the screen
--
-- This is the only one of the three with a decision behind it, and the
-- decision was already made on the pricing page: Starter's feature list
-- has no reporting line, Professional's says "Reports across every
-- site". `plans.features` has agreed since 0030. What was missing was
-- anything reading it.
--
-- **It is enforced in the client, and that is not a lapse — it is the
-- honest ceiling here.** The reports screen computes its rows in the
-- browser from `clock_events` and `staff_profiles`, which RLS already
-- grants the organisation because they are the organisation's own
-- records. There is no server-side report endpoint to refuse, and
-- inventing one that hid a customer's own data from them would be a
-- worse product than an unlocked screen.
--
-- So: this is packaging, not a security control, and the register says
-- so in those words. It sits alongside `seat_limit` and
-- `location_limit`, which ARE database-enforced (0070) because they
-- govern writes, and alongside `ai_rota_assistant`, which is enforced in
-- the Edge Function (0074) because each use spends money at a third
-- party. The rule this project keeps — "a control whose only enforcement
-- is a disabled button is not a control" — is about controls. A paywall
-- over a customer's own rows is a different thing, and calling it
-- enforcement is the failure mode worth avoiding.
-- =====================================================================

-- ── gps_clock_in is part of the product ───────────────────────────────
update public.plans
   set features = array_remove(features, 'gps_clock_in')
 where 'gps_clock_in' = any(features);

update public.feature_flags
   set retired_reason = 'Not an entitlement: every plan includes it, so a gate could never refuse anything. Part of the product, removed from plans.features in 0090.'
 where key = 'gps_clock_in';

-- ── beta_integrations gates nothing that exists ───────────────────────
update public.feature_flags
   set enabled = false,
       rollout = 0,
       retired_at = coalesce(retired_at, timezone('utc', now())),
       retired_reason = 'Describes payroll and HR connectors that do not exist. The only tenant-reachable integration is their own SMTP, and every platform connector is marked planned (0073).'
 where key = 'beta_integrations'
   and retired_at is null;

insert into public.feature_flag_changes
  (flag_key, actor_name, field, before_value, after_value)
select 'beta_integrations', 'Migration 0090', 'enabled', 'false', 'retired'
 where exists (select 1 from public.feature_flags where key = 'beta_integrations')
   and not exists (
     select 1 from public.feature_flag_changes
      where flag_key = 'beta_integrations' and after_value = 'retired');

-- ── advanced_reporting stays, and the plans that sell it keep it ──────
--
-- No change to the data: 0030 already set it on professional, business and
-- enterprise, matching the pricing page. Asserted here so a future edit to
-- the seed has to disagree with a test rather than drift quietly.
do $$
begin
  if exists (
    select 1 from public.plans
     where code = 'starter' and 'advanced_reporting' = any(features)
  ) then
    raise exception 'Starter must not include advanced_reporting: the pricing page sells reporting from Professional up.';
  end if;
  if exists (
    select 1 from public.plans
     where code in ('professional', 'business', 'enterprise')
       and not ('advanced_reporting' = any(features))
  ) then
    raise exception 'Professional and above must include advanced_reporting.';
  end if;
end;
$$;
