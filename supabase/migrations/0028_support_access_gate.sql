-- =====================================================================
-- 0028. A support access session becomes the gate, not a note about one
--
-- Since 0002, `is_org_member()` has ended with `or public.is_platform_admin()`
-- and `has_org_role()` with the same. Every tenant policy is built on those two
-- functions, so a platform administrator has been able to read and write every
-- organisation's rotas, staff records, clock events and leave, at any time,
-- with no grant and no expiry.
--
-- 0019 then added support access sessions: a reason, a case reference, a scope
-- and an expiry, recorded and audited. It has never been consulted by a policy.
-- Access has been identical with or without one.
--
-- This closes that. A platform administrator now reaches tenant data only
-- through a session that is theirs, unrevoked, and unexpired, and may only
-- write through one whose scope says `read_write`.
--
-- ## Why the change is two functions and not forty policies
--
-- 0002 generates the tenant policies in a loop, and every one of them calls
-- `is_org_member(org_id)` or `has_org_role(org_id, ...)`. Redefining those two
-- moves the gate everywhere at once, which is also the only way to be sure
-- nothing was missed.
--
-- ## What deliberately does not change
--
-- Platform tables. `organisations`, `subscriptions`, `invoices`, `audit_logs`,
-- `incidents`, `feature_flags`, `platform_settings` and the rest carry their
-- own `is_platform_admin()` or `has_platform_role()` policies and never route
-- through the two functions above. Running the business does not require
-- reading anybody's shifts.
--
-- Aggregate counts. The console reports how many staff and published rotas
-- exist per tenant, which is a number rather than a person. Those move to
-- `platform_tenant_counts()`, a SECURITY DEFINER function that returns counts
-- and never a row. A support session is not needed to know that an
-- organisation has 248 staff; it is needed to know who they are.
--
-- ## The consequence, stated plainly
--
-- Without an active session, the Organisation detail screen's Users, Locations
-- and Data tabs return nothing for a platform administrator. That is the point.
-- The screen says so rather than rendering an empty table.
-- =====================================================================

-- ---------- The gate ----------------------------------------------------
create or replace function public.has_support_access(
  p_org   uuid,
  p_write boolean default false
) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.support_access_sessions s
     where s.org_id = p_org
       and s.admin_user_id = auth.uid()
       and s.revoked_at is null
       and s.expires_at > timezone('utc', now())
       -- A read session cannot write. The scope was always recorded; now it
       -- decides something.
       and (not p_write or s.scope = 'read_write')
  );
$$;

comment on function public.has_support_access(uuid, boolean) is
  'True while this administrator holds an unrevoked, unexpired session for this organisation. The write form additionally requires scope = read_write.';

grant execute on function public.has_support_access(uuid, boolean) to authenticated;

-- ---------- Membership, redefined ---------------------------------------
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
     where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  ) or public.has_support_access(p_org, false);
$$;

comment on function public.is_org_member(uuid) is
  'A member of this organisation, or a platform administrator holding an active support access session for it. Being a platform administrator is no longer sufficient on its own.';

create or replace function public.has_org_role(p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
     where m.org_id = p_org and m.user_id = auth.uid()
       and m.status = 'active' and m.role = any (p_roles)
  ) or public.has_support_access(p_org, true);
$$;

comment on function public.has_org_role(uuid, text[]) is
  'Holds one of these roles in this organisation, or a platform administrator with a read_write support session. A read-only session does not satisfy this.';

-- ---------- Counts, without rows ----------------------------------------
-- The console needs to say how large a tenant is without reading who is in it.
-- SECURITY DEFINER so it can count past RLS, and gated on the platform roles
-- so it cannot be called by a customer to size their competitors.
create or replace function public.platform_tenant_counts(p_org uuid)
returns table (
  staff_total     bigint,
  staff_active    bigint,
  locations       bigint,
  departments     bigint,
  published_rotas bigint,
  shifts_month    bigint
) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform staff can read tenant counts'
      using errcode = '42501';
  end if;

  return query
    select
      (select count(*) from public.staff_profiles where org_id = p_org),
      (select count(*) from public.staff_profiles where org_id = p_org and active),
      (select count(*) from public.locations where org_id = p_org),
      (select count(*) from public.departments where org_id = p_org),
      (select count(*) from public.rotas where org_id = p_org and status = 'published'),
      (select count(*) from public.shifts
        where org_id = p_org
          and starts_at >= date_trunc('month', timezone('utc', now())));
end;
$$;

revoke all on function public.platform_tenant_counts(uuid) from public, anon;
grant execute on function public.platform_tenant_counts(uuid) to authenticated;

-- The same, across every tenant, for the overview tiles.
create or replace function public.platform_totals()
returns table (
  organisations   bigint,
  active_orgs     bigint,
  profiles        bigint,
  staff_profiles  bigint,
  published_rotas bigint,
  shifts_month    bigint
) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform staff can read platform totals'
      using errcode = '42501';
  end if;

  return query
    select
      (select count(*) from public.organisations),
      (select count(*) from public.organisations where status = 'active'),
      (select count(*) from public.profiles),
      (select count(*) from public.staff_profiles),
      (select count(*) from public.rotas where status = 'published'),
      (select count(*) from public.shifts
        where starts_at >= date_trunc('month', timezone('utc', now())));
end;
$$;

revoke all on function public.platform_totals() from public, anon;
grant execute on function public.platform_totals() to authenticated;

-- ---------- An orphan, removed ------------------------------------------
-- `incident_events` existed in the production database, in no migration file
-- and no application code. It was empty, carried no insert grant, and was
-- found only because PostgREST suggested it as a near match while `incidents`
-- was missing. Dropped so that the migrations describe the database again. If
-- something did rely on it, this line is where to look.
drop table if exists public.incident_events;
