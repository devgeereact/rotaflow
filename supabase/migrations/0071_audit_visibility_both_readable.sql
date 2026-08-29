-- =====================================================================
-- 0071_audit_visibility_both_readable.sql — make `visibility = 'both'`
-- actually readable by the tenant (docs/SAAS.md BUG-055)
--
-- 0032 widened the CHECK on `audit_logs.visibility` to accept 'both', and
-- justified it like this:
--
--     "The 0016 read policy already handles it correctly, admitting an org
--      reader when visibility is not 'platform_only' and a platform reader
--      always. Only the CHECK was narrower than the design."
--
-- The first half of that is not true. 0016's policy tests
-- `visibility = 'org'`, an equality — not `<> 'platform_only'`. So since
-- 0032 every row written as 'both' has been readable by platform staff and
-- by nobody else, which is the exact opposite of what 'both' means and of
-- what its own column comment promises:
--
--     'both: written when an event genuinely belongs to both audiences,
--      such as a support session opened against a customer.'
--
-- A support session opened against a customer is precisely the event that
-- customer most needs to see. Five such rows exist in production today,
-- and the count only grows.
--
-- This is a one-word fix to the predicate 0032 believed it already had.
-- Nothing else about the policy changes: platform admins still read
-- everything, 'platform_only' stays platform-only, org_id must still be
-- non-null, and an owner or the actor themselves is still the test for
-- who inside the tenant may read a row.
--
-- WHILE HERE: the actor branch is left exactly as it is. `/app/account/
-- activity` looks empty for most people, and the cause is not this policy
-- — it is that 291 of production's 331 org-visible rows carry no
-- `actor_user_id` at all, because they were written by triggers firing
-- with no `auth.uid()` (migrations, service_role, seed). Widening the
-- policy would not surface a single one of them. That is recorded as
-- BUG-063 rather than papered over here.
--
-- MIGRATION RISK. One policy replaced. No table altered, no row rewritten,
-- no grant changed. It STRICTLY WIDENS what a tenant can read, by exactly
-- the set 0032 intended, so nothing that could read a row before can read
-- less now. Reversible by re-applying 0016's version.
-- =====================================================================

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select
  using (
    public.is_platform_admin()
    or (
      -- Was `visibility = 'org'`, which silently excluded 'both'.
      visibility <> 'platform_only'
      and org_id is not null
      and (
        public.has_org_role(org_id, array['owner'])
        -- Profile → Activity. A deliberate widening beyond owner-only: these
        -- are the reader's own actions. It carries an obligation, kept by the
        -- trigger bodies in 0016 rather than trusted to callers — `metadata`
        -- on an event an ordinary member can read must not embed identifiers
        -- they did not already see.
        or actor_user_id = auth.uid()
      )
    )
  );
