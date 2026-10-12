-- =====================================================================
-- 0154_a_trial_then_a_plan.sql: every organisation starts with a 30-day
-- trial, and an organisation that has neither a trial nor a paid plan is
-- read-only rather than free (owner decision D2, docs/SAAS.md CAP-125,
-- GAP-126; plan docs/Plans 2026/03 B3, 09 F1)
--
-- ## The hole
--
-- `0120` derives `organisations.plan` from the subscription, and anything
-- that is not `trialing`, `active` or `past_due` inside its grace falls
-- back to `'starter'`, which `0120` called "the free tier". Starter costs
-- £29. So an organisation that never paid, or cancelled, kept Starter
-- limits for ever, and the product said so to the customer during
-- onboarding while the pricing FAQ said every plan was paid. Nothing ever
-- wrote `subscriptions.trial_ends_at` either (`0023:68`), so there was no
-- trial to speak of.
--
-- ## The design, and why this shape
--
-- **The trial lives on the organisation**, as `organisations.trial_ends_at`,
-- defaulted to thirty days after creation. Not on `subscriptions`, for
-- three reasons that each would have cost more than a column:
--
--   * `subscriptions.org_id` is UNIQUE and the Stripe webhook upserts on
--     it. A trial row created at sign-up would have to be inserted by
--     every creation path, collide with `admin_create_organisation_with_
--     invite` (`0084`), which inserts its own row, and be mistaken by the
--     Checkout guard and the platform's MRR and churn figures for a real
--     subscription.
--   * `subscriptions` is owner-only under RLS (`0002`), and a manager is
--     exactly the person who needs to know the organisation is read-only.
--   * A column default reaches every creation path (onboarding, the
--     console, import) without editing any of them, the same argument
--     `0153` made. The browser cannot write it: `authenticated` holds
--     column-level INSERT and UPDATE grants on `organisations` (`0117`,
--     `0120`) and this column is in neither.
--
-- `subscriptions.trial_ends_at` keeps its meaning: a STRIPE trial's end,
-- written by the webhook from now on.
--
-- **The trial has Professional limits.** `organisations.plan` now defaults
-- to `'professional'`. A browser-created organisation cannot name a plan
-- (`0120`), so it takes the default; the console's create path names one
-- and keeps it.
--
-- **State is computed, not stored.** `org_billing_state(org)` answers from
-- the clock every time it is asked, so a trial or a grace window that ends
-- at 03:00 is over at 03:00, with no scheduled job to forget:
--
--   active     the subscription is `active`
--   trialing   a Stripe trial: `trialing`, and its own trial end, if
--              recorded, is still ahead
--   grace      `past_due` and `grace_until` (`0098`) is still ahead
--   trial      none of those, and the organisation's own trial is running
--   read_only  none of the above
--
-- `org_is_read_only(org)` is that state equal to `read_only`. It is the
-- one function every guard below calls.
--
-- ## What read-only blocks, and what it deliberately does not
--
-- D2: nobody is locked out and nothing is lost. Managers cannot BUILD
-- until a plan is chosen; real work already happening keeps working.
--
-- Blocked, server-side, with SQLSTATE `BILL1`:
--
--   * `rotas` INSERT and UPDATE. That is creating a rota, publishing,
--     unpublishing and opening a revision (`publish_rota`, `0061`), and
--     repeating weeks (`0107`), because every one of them writes `rotas`.
--   * `shifts` INSERT and UPDATE. Adding, moving and assigning shifts, and
--     the two staff paths that change the rota: claiming an open shift
--     (`0103`) and a swap decision (`0123`). A frozen rota is frozen for
--     everybody.
--   * `invites` INSERT. No new people. Accepting or revoking an invite
--     that already exists is an UPDATE and still works.
--   * Plan features: `org_has_feature` and `my_feature_access` report no
--     plan feature for a read-only organisation, so the AI assistant
--     (which costs money per call) and advanced reporting stop.
--
-- Allowed, on purpose:
--
--   * Reading everything, and exports, which are reads.
--   * Clock-in and clock-out (`clock_events`), timesheets, leave requests
--     and leave decisions. A shift somebody is standing in must still be
--     recorded, and leave is a legal entitlement, not a product feature.
--   * DELETE anywhere. Removing is not building, and an organisation's
--     own erasure (`delete_organisation`) cascades through these tables.
--   * Billing: Checkout and the Billing Portal are Edge Functions that
--     write nothing here, and the webhook runs as `service_role`.
--
-- **Who the guard applies to.** Only a request carrying an
-- `authenticated` JWT. `service_role` (the webhook, Edge Functions doing
-- cross-tenant work) and `pg_cron` jobs (no JWT at all) pass, so no
-- scheduled job can fail because a customer has not paid. A platform
-- administrator passes too, so support can repair data and re-invite an
-- owner who has left.
--
-- ## Existing organisations
--
-- Every existing organisation is given a trial ending thirty days after
-- this migration runs, and every one without an entitling subscription is
-- moved to Professional limits for that trial. Nobody becomes read-only
-- the moment this merges, and every existing tenant gets the same thirty
-- days and the same in-app notice a new one gets. Production held no
-- paying organisation when this was written; an organisation that pays is
-- untouched in substance, because its subscription decides its state.
--
-- SAFETY: nothing is dropped and no column type changes. The two UPDATEs
-- are bounded by WHERE clauses explained where they appear; the first only
-- fills a column this migration adds, the second only RAISES limits.
-- Every guard is a BEFORE trigger that refuses, so a wrong guard fails a
-- write loudly rather than losing data, and is reversed by dropping the
-- trigger. The function-body replacements keep their signatures and
-- grants.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The trial, on the organisation.
-- ---------------------------------------------------------------------
alter table public.organisations
  add column if not exists trial_ends_at timestamptz;

-- Existing organisations: thirty days from now. Bounded to rows that have
-- no value, which is every row the first time and none on a re-run.
update public.organisations
   set trial_ends_at = timezone('utc', now()) + interval '30 days'
 where trial_ends_at is null;

alter table public.organisations
  alter column trial_ends_at set default (timezone('utc', now()) + interval '30 days');

comment on column public.organisations.trial_ends_at is
  'When this organisation''s free trial ends. Set by the column default to 30 days after creation (0154); the browser cannot write it. After it, without an active or trialing Stripe subscription or a past-due grace window, the organisation is read-only (org_is_read_only).';

-- The trial carries Professional limits.
alter table public.organisations
  alter column plan set default 'professional';

-- Existing organisations without an entitling subscription join the trial
-- on the same limits a new one gets. Only ever raises a limit: no row on a
-- paid plan is touched, and no row is moved down.
update public.organisations o
   set plan = 'professional'
 where o.plan = 'starter'
   and not exists (
     select 1
       from public.subscriptions s
      where s.org_id = o.id
        and (
          s.status in ('trialing', 'active')
          or (s.status = 'past_due' and s.grace_until > timezone('utc', now()))
        )
   );

-- ---------------------------------------------------------------------
-- 2. The state, computed from the clock.
-- ---------------------------------------------------------------------
create or replace function public.org_billing_state(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when s.status = 'active' then 'active'
    when s.status = 'trialing'
         and (s.trial_ends_at is null or s.trial_ends_at > now()) then 'trialing'
    when s.status = 'past_due'
         and s.grace_until is not null and s.grace_until > now() then 'grace'
    when o.trial_ends_at is not null and o.trial_ends_at > now() then 'trial'
    else 'read_only'
  end
    from public.organisations o
    left join public.subscriptions s on s.org_id = o.id
   where o.id = p_org;
$$;

comment on function public.org_billing_state(uuid) is
  'active | trialing (Stripe) | grace (past due, inside grace_until) | trial (the organisation''s own 30-day trial) | read_only. Computed from the clock on every call, so nothing has to run for a trial to end. Server-only: the browser reads my_org_billing_state. See 0154.';

create or replace function public.org_is_read_only(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.org_billing_state(p_org) = 'read_only', false);
$$;

comment on function public.org_is_read_only(uuid) is
  'True when the organisation has no running trial, no active or trialing subscription and no grace window: managers cannot build rotas or invite until a plan is chosen (D2, 0154). An unknown organisation is not read-only; RLS already refuses it.';

revoke all on function public.org_billing_state(uuid) from public, anon, authenticated;
revoke all on function public.org_is_read_only(uuid)  from public, anon, authenticated;
grant execute on function public.org_billing_state(uuid) to service_role;
grant execute on function public.org_is_read_only(uuid)  to service_role;

-- What the browser reads. Any member, not only the owner, because a
-- manager is the person the read-only banner is for. A non-member gets no
-- row, which is indistinguishable from an organisation that does not exist.
create or replace function public.my_org_billing_state(p_org uuid)
returns table (state text, trial_ends_at timestamptz, read_only boolean)
language sql
stable
security definer
set search_path = public
as $$
  select public.org_billing_state(o.id),
         o.trial_ends_at,
         public.org_billing_state(o.id) = 'read_only'
    from public.organisations o
   where o.id = p_org
     and public.is_org_member(p_org);
$$;

comment on function public.my_org_billing_state(uuid) is
  'The caller''s view of their organisation''s billing state: the state, the trial end and whether it is read-only. Members only. See 0154.';

revoke all on function public.my_org_billing_state(uuid) from public, anon;
grant execute on function public.my_org_billing_state(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. The guard on the write paths.
-- ---------------------------------------------------------------------
create or replace function public.enforce_org_not_read_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  -- Only an end user's request is held to the plan. The webhook and Edge
  -- Functions acting as service_role, and pg_cron jobs, which carry no JWT
  -- at all, must never fail because a customer has not paid.
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), ''), '{}'
  )::jsonb ->> 'role';
  if v_role is distinct from 'authenticated' then
    return new;
  end if;

  -- Support can repair data and re-invite an owner who has left.
  if public.is_platform_admin() then
    return new;
  end if;

  if public.org_is_read_only(new.org_id) then
    raise exception
      'Your trial has ended. Choose a plan in Settings, Billing to keep building rotas.'
      using errcode = 'BILL1',
            hint = 'Everything already recorded is still here and can be exported. Staff can still clock in and request leave.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_org_not_read_only() is
  'BEFORE trigger on rotas, shifts (INSERT, UPDATE) and invites (INSERT): refuses with BILL1 when org_is_read_only. Applies to authenticated requests only; service_role, pg_cron and platform administrators pass. See 0154.';

revoke all on function public.enforce_org_not_read_only() from public, anon, authenticated;

drop trigger if exists rotas_enforce_not_read_only on public.rotas;
create trigger rotas_enforce_not_read_only
  before insert or update on public.rotas
  for each row execute function public.enforce_org_not_read_only();

drop trigger if exists shifts_enforce_not_read_only on public.shifts;
create trigger shifts_enforce_not_read_only
  before insert or update on public.shifts
  for each row execute function public.enforce_org_not_read_only();

drop trigger if exists invites_enforce_not_read_only on public.invites;
create trigger invites_enforce_not_read_only
  before insert on public.invites
  for each row execute function public.enforce_org_not_read_only();

-- ---------------------------------------------------------------------
-- 4. A read-only organisation has no plan features.
--
-- Bodies as in `0074`, with one added condition each. Same signatures, so
-- `create or replace` keeps the grants `0113` recorded.
-- ---------------------------------------------------------------------
create or replace function public.org_has_feature(p_org uuid, p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when not public.is_org_member(p_org) then false
    when public.org_is_read_only(p_org) then false
    else coalesce(
      (select p_feature = any (pl.features)
         from public.organisations o
         join public.plans pl on pl.code = o.plan
        where o.id = p_org),
      false)
  end;
$$;

comment on function public.org_has_feature(uuid, text) is
  'Plan entitlement, not a feature flag. True when the organisation''s plan lists the feature AND the caller is a member of it (or holds a support-access session for it, per 0028), AND the organisation is not read-only (0154). A non-member always gets false, which is indistinguishable from a real "no".';

create or replace function public.my_feature_access(p_org uuid)
returns table (feature text, source text)
language sql stable security definer set search_path = public as $$
  select f.key, 'flag'::text
    from public.feature_flags f
   where public.is_org_member(p_org)
     and f.retired_at is null
     and public.flag_enabled_for_org(f.key, p_org)
  union
  select unnest(pl.features), 'plan'::text
    from public.organisations o
    join public.plans pl on pl.code = o.plan
   where o.id = p_org
     and public.is_org_member(p_org)
     and not public.org_is_read_only(p_org);
$$;

comment on function public.my_feature_access(uuid) is
  'Every feature this organisation can use, and whether a flag or its plan grants it. One call per organisation load. Returns nothing at all for a caller who is neither a member nor holding a support-access session, and no plan feature for a read-only organisation (0154).';

-- ---------------------------------------------------------------------
-- 5. The subscription sync no longer invents a free tier.
--
-- `0120` fell back to 'starter' for anything not entitled. Now:
--   * entitled: the subscription's plan, as before;
--   * not entitled but the organisation's own trial is running: the trial's
--     Professional limits (cancelling a paid plan on day five does not
--     shorten the trial the organisation was given);
--   * otherwise: the column is left as it was. The organisation is
--     read-only, which `org_is_read_only` decides from the clock; writing
--     a cheaper plan into the column would only restate the old free tier.
--
-- `trialing` entitles only while a recorded Stripe trial end is ahead, so
-- this agrees with `org_billing_state`.
-- ---------------------------------------------------------------------
create or replace function public.sync_org_plan_from_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entitled  boolean;
  v_trial_end timestamptz;
  v_plan      text;
begin
  v_entitled :=
    new.status = 'active'
    or (
      new.status = 'trialing'
      and (new.trial_ends_at is null or new.trial_ends_at > timezone('utc', now()))
    )
    or (
      new.status = 'past_due'
      and new.grace_until is not null
      and new.grace_until > timezone('utc', now())
    );

  if v_entitled then
    v_plan := new.plan;
  else
    select o.trial_ends_at into v_trial_end
      from public.organisations o
     where o.id = new.org_id;

    if v_trial_end is not null and v_trial_end > timezone('utc', now()) then
      v_plan := 'professional';
    else
      return new;
    end if;
  end if;

  update public.organisations
     set plan = v_plan
   where id = new.org_id
     and plan is distinct from v_plan;

  return new;
end;
$$;

comment on function public.sync_org_plan_from_subscription() is
  'Keeps organisations.plan in step with the paid subscription, or with the organisation''s own trial (Professional) when nothing is paid. The plan column is the entitlement 0070 enforces, so it is server-owned. There is no free tier: an organisation with neither is read-only (org_is_read_only), and the column is left alone. See 0120, 0154.';

drop trigger if exists subscriptions_sync_org_plan on public.subscriptions;
create trigger subscriptions_sync_org_plan
  after insert or update of status, plan, grace_until, trial_ends_at
  on public.subscriptions
  for each row
  execute function public.sync_org_plan_from_subscription();
