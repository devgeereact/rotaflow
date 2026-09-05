-- =====================================================================
-- 0118_only_an_owner_hands_out_ownership.sql — close the manager-to-owner
-- escalation by removing the write path, not by adding a check
-- (docs/SAAS.md GAP-065)
--
-- ## The escalation, stated plainly
--
-- Any manager could make themselves an owner of their own organisation in
-- two HTTP requests, with no owner involved:
--
--   1. POST /rest/v1/invites
--      { org_id: <their org>, email: <their own address>,
--        role: 'owner', token_hash: sha256(<a token they chose>) }
--   2. POST /rest/v1/rpc/accept_invite { p_token: <that token> }
--
-- Every link verified against **production** on 2026-09-05, read-only:
--
--   * `invites_write` is `for all` with both `using` and `with check` set
--     to `has_org_role(org_id, array['owner','manager'])`, and says nothing
--     about the `role` column, so a manager's insert passes.
--   * `authenticated` held INSERT, UPDATE and DELETE on `public.invites`.
--   * `role` is client-writable and `invites_role_check` permits 'owner';
--     `token_hash` is client-writable with no trigger or default setting
--     it, so the attacker knows the token; `expires_at` defaults to
--     +7 days.
--   * `accept_invite` is SECURITY DEFINER. It checks the caller is signed
--     in, that the invite is live, and that the invite's email matches the
--     caller's. It does not, and cannot, check who created the row or
--     whether they were allowed to grant that role. It then runs
--     `on conflict (org_id, user_id) do update set role = excluded.role`,
--     which UPGRADES the attacker's existing manager membership to owner.
--
-- An owner can call `delete_organisation`, and GAP-001 says there is no
-- backup of production, so the prize is the tenant.
--
-- ## Why the rule existed and was not enforced here
--
-- `create_invite` already holds it, explicitly:
--
--   -- Only an owner may hand out ownership.
--   if p_role = 'owner' and not has_org_role(p_org, array['owner']) then
--     raise exception 'Only an owner can invite another owner'
--
-- and its header explains why it must: "SECURITY DEFINER bypasses RLS, so
-- the role check must be explicit here." That is exactly right, and it is
-- the mirror image of the defect. The function guarded itself against RLS
-- being absent; the policy never guarded against the function being
-- bypassed. Two paths reach the same table and only one carried the rule.
--
-- ## Removing the path rather than duplicating the rule
--
-- The client never inserts an invite. `inviteService.ts` calls
-- `create_invite` (`:55`) to make one, `accept_invite` (`:96`) to take one,
-- SELECTs to list pending ones (`:105`), and issues exactly one direct
-- write: `update { revoked_at }` (`:123`). `send-invite` only SELECTs
-- invites with the caller's JWT and does its privileged work through a
-- separate service_role client.
--
-- So the INSERT privilege was never used by anything. A narrower policy
-- would have left a write path open and relied on getting its predicate
-- right; taking the privilege away leaves no path to get wrong, and every
-- invite now goes through the function that already holds the rule. The
-- policy is narrowed too, so the guard does not depend on the grant alone.
--
-- SAFETY(revoke): these privileges are removed from `authenticated` only.
-- No data is touched and no row is deleted. `service_role` keeps its full
-- grant (`0056`), so the Edge Functions and scheduled jobs are unaffected,
-- and `create_invite`/`accept_invite` are SECURITY DEFINER and run as the
-- owner, so neither depends on the caller holding these. The one direct
-- client write, revoking an invite, is preserved by the column grant
-- below and covered by `invite_write_paths.test.sql`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Take away the write path that was never used.
-- ---------------------------------------------------------------------
revoke insert, update, delete on public.invites from authenticated;

-- The only direct invite write the client makes: soft-revoking one.
-- `inviteService.revokeInvite` sets this and nothing else.
grant update (revoked_at) on public.invites to authenticated;

-- ---------------------------------------------------------------------
-- 2. Narrow the policy so it states the rule too, rather than leaving it
--    to the grant. A manager may still invite staff and managers; only an
--    owner may create or alter a row that hands out ownership.
-- ---------------------------------------------------------------------
drop policy if exists invites_write on public.invites;

create policy invites_write on public.invites
  for all
  using (
    public.has_org_role(org_id, array['owner'])
    or (public.has_org_role(org_id, array['manager']) and role <> 'owner')
  )
  with check (
    public.has_org_role(org_id, array['owner'])
    or (public.has_org_role(org_id, array['manager']) and role <> 'owner')
  );

comment on policy invites_write on public.invites is
  'Owners may write any invite. Managers may write any invite except one '
  'granting ownership — the same rule create_invite enforces, so both '
  'paths to this table agree. See 0118.';
