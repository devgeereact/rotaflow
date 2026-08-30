-- =====================================================================
-- 0074_entitlement_checks_require_membership.sql — the entitlement
-- functions stop answering for organisations the caller is not in
-- (docs/SAAS.md CAP-038)
--
-- CAP-038 is about wiring `org_has_feature` and `my_feature_access` up
-- to something, since neither has ever had a caller. Before giving them
-- callers, they need the guard they never needed while unused.
--
-- Both are `security definer` and both take an organisation id, and
-- neither checks that the caller belongs to it. So any signed-in user
-- could ask what plan features any organisation has, by id:
--
--     select org_has_feature('<someone else''s org>', 'ai_rota_assistant');
--     select * from my_feature_access('<someone else''s org>');
--
-- `organisations` is behind RLS and a stranger cannot read a row from
-- it — but these two functions run as their owner, so RLS does not
-- apply inside them. What leaks is commercial: which tier a given
-- tenant is on, and by extension roughly what they pay. Not severe, and
-- it needs an org id the caller is unlikely to hold, which is why it
-- has sat here since 0030. It stops being acceptable the moment the
-- application starts calling these on every organisation load.
--
-- FAIL CLOSED, AND SILENTLY. A non-member gets `false` and an empty
-- set, not an exception. Raising would confirm the organisation exists,
-- which is most of what was being protected; and "no features" is the
-- same answer the caller's own gates already treat as safe.
--
-- `is_org_member` IS THE WHOLE PREDICATE, deliberately.
--
-- Two things it already handles, and adding either explicitly would be
-- a bug rather than belt-and-braces:
--
--   * Platform staff. 0028 removed standing platform-admin access from
--     `is_org_member` — "being a platform administrator is no longer
--     sufficient on its own" — and replaced it with
--     `has_support_access(p_org, false)`. So support reaches a tenant's
--     entitlements by opening a time-boxed, audited, owner-visible
--     support session, exactly like every other tenant read. Writing
--     `or is_platform_admin()` here would quietly re-open the standing
--     back door 0028 exists to close, on a function about to gain
--     callers on every page load.
--
--   * Role. Entitlements describe what the tenant bought, and any
--     member of the tenant may know that. Whether they may *use* a
--     feature is a separate question asked at each call site —
--     `ai-rota-assistant` checks `has_org_role(owner, manager)`
--     immediately before it checks this.
--
-- MIGRATION RISK. Two functions replaced, both `create or replace`, no
-- signature change, so no grant is dropped or re-created. Neither has a
-- caller today — that is CAP-038's whole complaint — so nothing in the
-- product can regress. Reversible by re-applying 0030's bodies.
-- =====================================================================

create or replace function public.org_has_feature(p_org uuid, p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when not public.is_org_member(p_org) then false
    else coalesce(
      (select p_feature = any (pl.features)
         from public.organisations o
         join public.plans pl on pl.code = o.plan
        where o.id = p_org),
      false)
  end;
$$;

comment on function public.org_has_feature(uuid, text) is
  'Plan entitlement, not a feature flag. True when the organisation''s plan lists the feature AND the caller is a member of it (or holds a support-access session for it, per 0028). A non-member always gets false, which is indistinguishable from a real "no".';

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
     and public.is_org_member(p_org);
$$;

comment on function public.my_feature_access(uuid) is
  'Every feature this organisation can use, and whether a flag or its plan grants it. One call per organisation load. Returns nothing at all for a caller who is neither a member nor holding a support-access session.';
