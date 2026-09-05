-- =====================================================================
-- 0120_stripe_owns_the_plan_column.sql — a paid tier is granted by a paid
-- subscription, not by a radio button (docs/SAAS.md GAP-062)
--
-- ## The hole
--
-- `organisations.plan` is the entitlement column. `0070` joins
-- `plans p on p.code = o.plan` to enforce `seat_limit` and
-- `location_limit`, and `my_feature_access` reads the same row for
-- `ai_rota_assistant` and `advanced_reporting`. It has also been writable
-- from the browser since `0017` put it in the client's column grant, and
-- `OnboardingPage` wrote it straight from a radio button. So:
--
--   PATCH /rest/v1/organisations?id=eq.<own org>  {"plan":"business"}
--
-- granted the AI assistant, advanced reporting, 200 seats and 20 sites,
-- for nothing. Table-level INSERT (`0056`) was the same hole through a
-- different door: an organisation could simply be created on 'enterprise'.
--
-- This was the shipped design from when nothing charged for anything, and
-- `0017` was right to list `plan` at the time. Stripe Checkout, the
-- Billing Portal and a signature-verified webhook have since shipped, so
-- the column now decides what a customer is owed, and it can no longer be
-- something the customer sets.
--
-- ## What replaces it
--
-- `plan` becomes server-owned:
--
--   * The browser may no longer write it, on INSERT or UPDATE. Every
--     organisation therefore starts on the column's default, `'starter'`,
--     which is the free tier and the correct answer for an org that has
--     not paid.
--   * `subscriptions_sync_org_plan` sets it from the subscription. The
--     Stripe webhook already upserts `public.subscriptions` on
--     `checkout.session.completed` and on every subscription event, so
--     the entitlement now follows the payment automatically.
--   * Onboarding's plan choice is recorded as `settings.intended_plan`,
--     which is what Checkout is opened with. Choosing Business no longer
--     grants Business; paying for it does.
--
-- The sync is a trigger rather than a line in the Edge Function on
-- purpose: **edge functions do not deploy on merge**, migrations do. A fix
-- that only works after somebody remembers to run
-- `supabase functions deploy stripe-webhook` is a fix that is off by
-- default. Everything here applies the moment this migration lands.
--
-- ## Which statuses entitle
--
-- `trialing` and `active` entitle. `past_due` entitles only while
-- `grace_until` is in the future — `subscriptions_track_grace_window`
-- (`0071`) already maintains that window, and cutting a customer off at
-- the first failed payment rather than at the end of the grace period
-- would be a worse product than the one that exists. `canceled`, and
-- `past_due` past its grace, fall back to `'starter'` rather than to
-- nothing, so a lapsed customer keeps their data and their rota and loses
-- the paid limits.
--
-- SAFETY(revoke): removes two privileges from `authenticated` only.
-- `service_role` is untouched, so the webhook and the scheduled jobs are
-- unaffected. No data is modified by the revokes themselves. The one
-- backfill below is bounded and explained where it appears.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The browser can no longer choose a plan, on either statement.
-- ---------------------------------------------------------------------
revoke update (plan) on public.organisations from authenticated;

-- `0056` granted table-level INSERT, which covers every column including
-- `plan`. Narrowed to what `orgService.createOrganisation` actually sends.
revoke insert on public.organisations from authenticated;
grant insert (
  name,
  slug,
  industry,
  settings,
  created_by
) on public.organisations to authenticated;

-- ---------------------------------------------------------------------
-- 2. The subscription decides the plan.
-- ---------------------------------------------------------------------
create or replace function public.sync_org_plan_from_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entitled boolean;
  v_plan     text;
begin
  v_entitled :=
    new.status in ('trialing', 'active')
    or (
      new.status = 'past_due'
      and new.grace_until is not null
      and new.grace_until > timezone('utc', now())
    );

  v_plan := case when v_entitled then new.plan else 'starter' end;

  -- `is distinct from` so an unrelated subscription update does not write
  -- a row that has not changed, which would otherwise put a no-op entry in
  -- `audit_logs` through `organisations_audit` on every webhook event.
  update public.organisations
     set plan = v_plan
   where id = new.org_id
     and plan is distinct from v_plan;

  return new;
end;
$$;

comment on function public.sync_org_plan_from_subscription() is
  'Keeps organisations.plan in step with the paid subscription. The plan '
  'column is the entitlement 0070 enforces, so it is server-owned: the '
  'browser cannot write it, and this is the only path that changes it. '
  'See 0120.';

drop trigger if exists subscriptions_sync_org_plan on public.subscriptions;
create trigger subscriptions_sync_org_plan
  after insert or update of status, plan, grace_until
  on public.subscriptions
  for each row
  execute function public.sync_org_plan_from_subscription();

-- ---------------------------------------------------------------------
-- 3. Bring existing rows into line with the rule that now governs them.
--
-- An organisation carrying a paid `plan` with no entitling subscription
-- was, by definition, never paid for — nothing but the browser could have
-- set it. Production holds zero organisations and zero subscriptions as
-- this is written, so this is expected to affect no rows; it exists so
-- that a database restored from an older dump, or a developer's local
-- copy, cannot come back with a self-assigned tier still in place.
-- ---------------------------------------------------------------------
update public.organisations o
   set plan = 'starter'
 where o.plan <> 'starter'
   and not exists (
     select 1
       from public.subscriptions s
      where s.org_id = o.id
        and (
          s.status in ('trialing', 'active')
          or (
            s.status = 'past_due'
            and s.grace_until is not null
            and s.grace_until > timezone('utc', now())
          )
        )
   );
