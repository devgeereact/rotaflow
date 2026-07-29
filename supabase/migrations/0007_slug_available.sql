-- =====================================================================
-- 0007_slug_available.sql — check an org slug is free, without leaking
--
-- The onboarding wizard shows live "that identifier is available" feedback
-- while the user types. That cannot be answered with a SELECT: the RLS
-- policy on `organisations` only exposes orgs the caller is a member of, so
-- a slug that is already taken looks free to everyone outside that org, and
-- the user only discovers the clash when the insert fails.
--
-- This returns a boolean and nothing else — no id, no name, no count — so it
-- confirms availability without becoming a tenant-enumeration endpoint.
-- =====================================================================

create or replace function public.slug_available(p_slug text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select not exists (
    select 1 from public.organisations
     where lower(slug) = lower(trim(p_slug))
  );
$$;

revoke all on function public.slug_available(text) from public, anon;
grant execute on function public.slug_available(text) to authenticated;
