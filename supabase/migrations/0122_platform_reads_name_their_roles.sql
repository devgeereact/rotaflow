-- =====================================================================
-- 0122_platform_reads_name_their_roles.sql — the read half of `0116`
-- (docs/SAAS.md GAP-053)
--
-- ## The gap
--
-- `is_platform_admin()` is role-blind. It is true for all four platform
-- roles, and it was the whole platform-side predicate on eight tables
-- holding operational tenant data. `platform_finance` is documented in
-- `src/lib/platformRoles.ts` as
--
--   "Subscriptions and billing state only. No operational tenant data."
--
-- and could read every one of them: the audit log, support cases
-- including messages flagged `is_internal`, incidents, every tenant's
-- integrations, every membership and every user profile on the platform.
--
-- `0116` fixed the same blindness for three WRITE paths and named the
-- roles out loud. This is the read half it left. It was left because
-- rewriting read policies without being able to run `supabase test db` is
-- the mistake this register keeps recording — the tooling is available
-- now, and `platform_reads.test.sql` goes with this change.
--
-- ## What this does not do
--
-- It does not split `platform_admin` from `platform_support`. That is a
-- second and separate product decision — whether support should see the
-- audit log, say — and nothing has asked for it. This closes exactly what
-- GAP-053 states: finance reads operational tenant data it is documented
-- not to have.
--
-- `organisations` is deliberately NOT changed, though the row names it.
-- The billing console calls `listAllOrganisations()`
-- (`AdminSubscriptionsPage`, `AdminBillingPage`), and an organisation's
-- name, slug, plan and status are billing state. Removing finance's read
-- there would break the one console that role exists to use, to hide a row
-- it is entitled to. `platform_user_auth_facts` is also named by the row
-- and **does not exist** in this schema; nothing was done about it because
-- there is nothing to do.
--
-- ## Why a composed helper and not a longer predicate
--
-- `is_platform_operational()` is `is_platform_admin()` AND a role test, so
-- it inherits the MFA condition `0102` added — an `aal2` session when
-- `platform_settings.require_mfa` is on. Writing the role list into each
-- policy instead would have silently dropped that gate from eight
-- policies, which is the kind of quiet regression a "tightening" change is
-- most likely to smuggle in.
--
-- Every policy below is otherwise reproduced exactly as it was: the
-- customer-facing halves — an owner reading their own org's audit rows, a
-- requester reading their own case, a person reading their own profile —
-- are untouched.
-- =====================================================================

create or replace function public.is_platform_operational()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
     and public.has_platform_role(
           array['platform_owner', 'platform_admin', 'platform_support']
         );
$$;

comment on function public.is_platform_operational() is
  'A platform administrator who may see operational tenant data: owner, '
  'admin or support, but not finance, which is billing-only by its own '
  'documented scope. Composed from is_platform_admin() so the MFA gate '
  '0102 added is inherited rather than restated. See 0122.';

-- `0112` made the default closed and `0113` put the grants in the history;
-- a function created after those still arrives with PostgreSQL's built-in
-- EXECUTE-to-PUBLIC, which `anon` inherits. Say both halves out loud, in the
-- migration that creates it, rather than leaving it to a default.
revoke execute on function public.is_platform_operational() from public, anon;
grant execute on function public.is_platform_operational() to authenticated;

-- ---------------------------------------------------------------------
-- audit_logs — who did what, across every tenant.
-- ---------------------------------------------------------------------
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select
  using (
    public.is_platform_operational()
    or (
      visibility <> 'platform_only'
      and org_id is not null
      and (
        public.has_org_role(org_id, array['owner'])
        or actor_user_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------
-- support_cases and their messages, internal notes included.
-- ---------------------------------------------------------------------
drop policy if exists support_cases_select on public.support_cases;
create policy support_cases_select on public.support_cases
  for select
  using (
    public.is_platform_operational()
    or requester_id = auth.uid()
    or (org_id is not null and public.has_org_role(org_id, array['owner']))
  );

drop policy if exists support_case_messages_select on public.support_case_messages;
create policy support_case_messages_select on public.support_case_messages
  for select
  using (
    public.is_platform_operational()
    or (
      not is_internal
      and exists (
        select 1
          from public.support_cases c
         where c.id = support_case_messages.case_id
           and (
             c.requester_id = auth.uid()
             or (c.org_id is not null and public.has_org_role(c.org_id, array['owner']))
           )
      )
    )
  );

-- ---------------------------------------------------------------------
-- incidents and their updates — release and operational state.
-- ---------------------------------------------------------------------
drop policy if exists incidents_select on public.incidents;
create policy incidents_select on public.incidents
  for select
  using (public.is_platform_operational());

drop policy if exists incident_updates_select on public.incident_updates;
create policy incident_updates_select on public.incident_updates
  for select
  using (public.is_platform_operational());

-- ---------------------------------------------------------------------
-- org_integrations — which payroll or rota connector a tenant uses.
-- ---------------------------------------------------------------------
drop policy if exists org_integrations_select on public.org_integrations;
create policy org_integrations_select on public.org_integrations
  for select
  using (public.is_platform_operational() or public.is_org_member(org_id));

-- ---------------------------------------------------------------------
-- memberships and profiles — who works where, and who everyone is.
-- ---------------------------------------------------------------------
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select
  using (
    public.is_org_member(org_id)
    or user_id = auth.uid()
    or public.is_platform_operational()
  );

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select
  using (auth.uid() = id or public.is_platform_operational());
