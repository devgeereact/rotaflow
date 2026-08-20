-- =====================================================================
-- 0031. Where the support gate stops
--
-- 0028 made `is_org_member()` and `has_org_role()` require a support access
-- session for a platform administrator. That was the intent for tenant data,
-- and it also caught three tables it should not have, because their policies
-- happen to be written in terms of the same two functions:
--
--   organisations   organisations_select uses is_org_member(id)
--   subscriptions   subscriptions_select uses has_org_role(org_id, owner)
--   memberships     memberships_select uses is_org_member(org_id)
--
-- With 0028 alone a platform administrator could not list the customers, see
-- which plan they are on, or see who administers them. The console has no
-- Organisations screen, no Users screen and no Overview, which is not a
-- privacy improvement. It is an outage.
--
-- ## The line this migration draws, and why it is here
--
-- Platform staff may read the *shape* of the business without a session:
-- which organisations exist, what they pay for, who belongs to them and in
-- what role. That is the customer register. Running a company on it is
-- ordinary, and a support session for every glance at a customer list would
-- be a ritual rather than a control.
--
-- Platform staff may not read the *workforce* without one: staff records with
-- phone numbers and payroll ids, rotas, shifts, clock events with GPS traces,
-- leave, timesheets, documents and emergency contacts. That is the data a
-- customer's own staff would object to being read, and it is what a session
-- now gates.
--
-- Both halves are deliberate, and this comment is the place a future reader
-- should argue with them.
-- =====================================================================

-- ---------- The customer register ---------------------------------------
drop policy if exists organisations_select on public.organisations;
create policy organisations_select
  on public.organisations for select
  using (
    public.is_org_member(id)
    -- The permanent creator backdoor 0005 closed stays closed: this is a
    -- platform role, checked live, not a column on the row.
    or public.is_platform_admin()
  );

drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select
  on public.subscriptions for select
  using (
    public.has_org_role(org_id, array['owner'])
    or public.has_platform_role(
         array['platform_owner','platform_admin','platform_finance'])
  );

-- Memberships are the account register: who belongs where, and as what. The
-- Users console screen is built on it, and support cannot help someone whose
-- organisation it cannot see. Staff *records* remain gated; a membership row
-- carries a user id and a role, not a payroll id or a phone number.
drop policy if exists memberships_select on public.memberships;
create policy memberships_select
  on public.memberships for select
  using (
    public.is_org_member(org_id)
    or user_id = auth.uid()
    or public.is_platform_admin()
  );

-- ---------- What is now gated, recorded so it can be checked ------------
comment on function public.is_org_member(uuid) is
  'A member of this organisation, or a platform administrator holding an active support access session for it. Gates staff records, rotas, shifts, clock events, leave, timesheets, documents and emergency contacts. It deliberately does not gate the organisation, subscription and membership registers: see 0031.';
