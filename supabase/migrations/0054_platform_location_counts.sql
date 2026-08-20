-- =====================================================================
-- 0054_platform_location_counts.sql — fix `/admin/organisations`'s "Sites"
-- column silently reading zero for every org without an open support
-- session
--
-- `countLocationsByOrg()` (src/services/platformService.ts) reads
-- `public.locations` directly as the signed-in platform administrator. Its
-- own comment claims this is safe because "is_org_member ends in or
-- public.is_platform_admin()" — true before 0028, false since: 0028
-- redefined `is_org_member()` to require an active support-access session
-- for a platform administrator, and `locations_select` was never added to
-- 0031's "customer register" carve-out (organisations/subscriptions/
-- memberships) the way `countPublishedRotas()`'s neighbouring comment
-- already documents this exact failure mode for a different table. The
-- practical effect: the admin Organisations table shows "Sites: 0" for
-- every tenant nobody currently has a support session open for — for a
-- brand-new QA org with one real location, confirmed live, 2026-08-20.
--
-- Fixed the same way `platform_totals()` (0028) already fixes the
-- equivalent problem for rota/shift counts: a narrow, aggregate-only
-- SECURITY DEFINER RPC. Deliberately not widening `locations_select` itself
-- — 0031's own comment calls that "the place a future reader should argue
-- with them", and a location's name/address is exactly the kind of tenant
-- detail 0031 chose to keep behind a support session; only the *count* is
-- customer-register-shaped data, so only the count is exposed here.
-- =====================================================================

create or replace function public.platform_location_counts()
returns table (org_id uuid, locations bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform staff can read platform location counts'
      using errcode = '42501';
  end if;

  return query
    select l.org_id, count(*) as locations
      from public.locations l
     group by l.org_id;
end;
$$;

revoke all on function public.platform_location_counts() from public, anon;
grant execute on function public.platform_location_counts() to authenticated;
