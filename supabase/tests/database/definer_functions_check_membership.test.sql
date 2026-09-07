-- =====================================================================
-- definer_functions_check_membership.test.sql — a SECURITY DEFINER
-- function reachable from a browser must scope itself to the caller
-- (docs/SAAS.md GAP-066, GAP-067)
--
-- RLS does not apply inside a SECURITY DEFINER function: it runs as its
-- owner, so the membership check has to be written in the body. Two
-- functions had neither the check nor any caller needing the grant —
-- `rota_amendment_changes` (`0083`) and `render_notification` (`0108`) —
-- and both were executable by `authenticated`, so a rota UUID from
-- another tenant was enough to read that organisation's staff ids, shift
-- dates and site names. `0119` revokes both grants.
--
-- `function_grant_invariants.test.sql` asserts what `anon` may execute.
-- It says nothing about `authenticated`, which is the role every signed-in
-- customer holds, and is where a cross-tenant read comes from. This is
-- that half.
--
-- ## Shown to fail on the real defect
--
-- With `0119` reverted and the database rebuilt, assertion 2 returns
-- exactly `render_notification, rota_amendment_changes`, and assertion 1
-- names them too. Both read clean once `0119` is applied.
--
-- ## The allowlist, and why each name is on it
--
-- The sweep looks for any guard idiom this schema actually uses. Three
-- functions legitimately use none, and each was read in full on
-- 5 September 2026 rather than assumed:
--
--   * `preview_invite` — deliberately `anon`-executable (`0075`) so an
--     invited person can see who invited them before signing up. Gated by
--     possession of the invite token, and returns only organisation name,
--     role, email and expiry, for a live invite.
--   * `slug_available` — two overloads. Both answer only "is this slug
--     taken", which sign-up needs before an account exists. The two-arg
--     overload carries its own guard against being used as an oracle: the
--     `p_exclude_org_id` branch proves ownership through `memberships`
--     rather than trusting the caller's assertion.
--   * `notification_delivery_configured` — returns `count(*) = 3` over
--     `vault.secrets` names. It discloses whether delivery is configured,
--     never a secret's value.
--
-- The other twelve definer functions `authenticated` may execute were read
-- in the same pass and every one guards itself: the platform-console
-- setters through `has_platform_role`, the calendar-feed pair through
-- `my_staff_profile_id`, `assign_support_case` through both. That review
-- was GAP-067, and it is what makes this assertion worth having — an
-- allowlist nobody has checked records that a sweep was silenced, not
-- that it passed.
--
-- Adding a name here is a security decision. Read the body first, and say
-- above what makes it safe.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(2);

-- ---------------------------------------------------------------------
-- 1. The class: nothing reachable by a signed-in user may skip the check.
-- ---------------------------------------------------------------------
select is(
  (
    select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and pg_get_function_result(p.oid) <> 'trigger'
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and p.proname not in (
         'preview_invite',
         'slug_available',
         'notification_delivery_configured'
       )
       -- Each idiom is matched as a CALL — the name followed by an open
       -- bracket — not as a bare name. `platform_user_facets` (0131) passed
       -- this sweep while guarding itself with `is_platform_operational`,
       -- and it passed for the wrong reason: its body selects the
       -- `profiles.is_platform_admin` COLUMN, and the old pattern could not
       -- tell a column reference from a guard. A function that merely reads
       -- that column and checks nothing would have been waved through.
       --
       -- `platform_admins` is gone from the list for the same reason: naming
       -- the table is not checking it. Every function that legitimately
       -- joined it also calls one of the predicates below.
       --
       -- `is_platform_operational()` (0122) is a guard and is now named as
       -- one. It is `is_platform_admin()` AND a role test, so it is strictly
       -- narrower than the predicate already on this list, and it inherits
       -- 0102's MFA condition.
       and pg_get_functiondef(p.oid) !~* 'is_org_member\s*\(|has_org_role\s*\(|is_platform_admin\s*\(|has_platform_role\s*\(|is_platform_operational\s*\(|my_staff_profile_id\s*\(|auth\.uid\s*\('
  ),
  '',
  'every SECURITY DEFINER function authenticated may execute scopes itself to the caller'
);

-- ---------------------------------------------------------------------
-- 2. The two measured leaking, named so a grant that reintroduces either
--    is caught by name rather than by a list somebody has stopped reading.
-- ---------------------------------------------------------------------
select is(
  (
    select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('rota_amendment_changes', 'render_notification')
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  '',
  'rota_amendment_changes and render_notification are not executable by authenticated'
);

select * from finish();
rollback;
