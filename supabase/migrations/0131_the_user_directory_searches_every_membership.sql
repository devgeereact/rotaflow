-- =====================================================================
-- 0131_the_user_directory_searches_every_membership.sql — searching
-- `/admin/users` by organisation finds a multi-organisation account
--
-- ## The gap
--
-- `summariseMembershipsByUser()` set `soleOrgName` only when an account
-- belonged to exactly one organisation:
--
--     soleOrgName: entry.names.size === 1 ? only : null
--
-- and `AdminUsersPage` searched `[email, full_name, soleOrgName]`. So an
-- account in two organisations could not be found by either of their
-- names — the one field carrying an organisation was deliberately null
-- for exactly those accounts. The people most likely to be searched for
-- by organisation are the ones a support case is about, and a
-- multi-organisation account is the one somebody is most likely to be
-- confused by in the first place.
--
-- Below the cap it also read the whole `profiles` table and the whole
-- `memberships` table into the browser, then filtered, sorted and
-- counted the arrays. The same truncation `0130` describes: PostgREST
-- stops at `db.max_rows` and says nothing, so the tile total becomes the
-- cap and a search for an older account reports "no matches".
--
-- ## One row per account, whatever its memberships
--
-- A join would return an account once per membership, so a person in
-- three organisations would appear three times and the total would count
-- them three times. Memberships are aggregated per account first, and
-- the filters are applied as `exists` over that account's memberships —
-- which is also what makes a *combination* mean what a reader expects:
-- organisation X **and** role owner has to match ONE membership, not an
-- owner somewhere and a membership at X.
--
-- ## Role scope
--
-- `is_platform_operational()`, not `is_platform_admin()`. `0122` put
-- `profiles` and `memberships` behind exactly that predicate, and a
-- SECURITY DEFINER function that checked only the weaker one would be
-- the way around it. `platform_finance` is refused here and the route is
-- gated to match, because RLS filters rather than raises: before this,
-- finance opened `/admin/users` and saw a one-account table, which reads
-- as a broken product rather than as a boundary.
--
-- SAFETY(none): additive. Two new functions, no table altered, no policy
-- changed, no grant widened beyond EXECUTE to `authenticated` on
-- functions that refuse a non-operational caller before reading anything.
-- =====================================================================

create or replace function public.platform_user_directory(
  p_search            text    default null,
  p_org               uuid[]  default null,
  p_role              text[]  default null,
  p_membership_status text[]  default null,
  -- 'platform' or 'standard'. Anything else is no filter, so a stale URL
  -- widens to everybody rather than emptying the table.
  p_platform_access   text    default null,
  p_sort              text    default 'created_at',
  p_direction         text    default 'desc',
  p_limit             integer default 25,
  p_offset            integer default 0
)
returns table (
  id                  uuid,
  email               text,
  full_name           text,
  avatar_url          text,
  is_platform_admin   boolean,
  platform_role       text,
  created_at          timestamptz,
  organisations       bigint,
  active_memberships  bigint,
  org_ids             uuid[],
  org_names           text[],
  roles               text[],
  membership_statuses text[],
  total_count         bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pattern text;
  v_limit   integer;
  v_offset  integer;
  v_sort    text;
  v_desc    boolean;
  v_access  text;
begin
  if not public.is_platform_operational() then
    raise exception 'Only an operational platform role can read the user directory'
      using errcode = '42501';
  end if;

  v_limit  := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  v_sort := case coalesce(p_sort, '')
              when 'name'          then 'name'
              when 'email'         then 'email'
              when 'organisations' then 'organisations'
              when 'access'        then 'access'
              else 'created_at'
            end;
  v_desc := lower(coalesce(p_direction, 'desc')) = 'desc';

  v_access := case when p_platform_access in ('platform', 'standard')
                   then p_platform_access end;

  -- `%` and `_` are ilike wildcards, and a backslash escapes them, so the
  -- backslash has to be escaped first or it escapes the escapes.
  v_pattern := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  return query
  with membership_facts as (
    -- One row per account, so nobody is listed twice for being in two
    -- organisations and the total counts people rather than memberships.
    select
      m.user_id,
      count(*)                                          as organisations,
      count(*) filter (where m.status = 'active')       as active_memberships,
      array_agg(distinct m.org_id)                      as org_ids,
      array_agg(distinct o.name order by o.name)        as org_names,
      array_agg(distinct m.role order by m.role)        as roles,
      array_agg(distinct m.status order by m.status)    as membership_statuses,
      -- Everything searchable about this account's organisations, flattened
      -- once here rather than joined per predicate.
      string_agg(o.name || ' ' || o.slug, ' ')          as org_search
      from public.memberships m
      join public.organisations o on o.id = m.org_id
     group by m.user_id
  ),
  directory as (
    select
      p.id,
      p.email,
      p.full_name,
      p.avatar_url,
      p.is_platform_admin,
      pa.role                                   as platform_role,
      p.created_at,
      coalesce(f.organisations, 0)              as organisations,
      coalesce(f.active_memberships, 0)         as active_memberships,
      coalesce(f.org_ids, '{}')                 as org_ids,
      coalesce(f.org_names, '{}')               as org_names,
      coalesce(f.roles, '{}')                   as roles,
      coalesce(f.membership_statuses, '{}')     as membership_statuses
      from public.profiles p
      left join membership_facts f on f.user_id = p.id
      -- The live grant only. A revoked row would otherwise keep showing a
      -- platform role beside an account that no longer holds one.
      left join public.platform_admins pa
             on pa.user_id = p.id and pa.revoked_at is null
     where (v_access is null
            or (v_access = 'platform' and p.is_platform_admin)
            or (v_access = 'standard' and not p.is_platform_admin))
       -- Organisation, role and status must be satisfied by ONE membership.
       -- Applied separately they would match an owner of some organisation
       -- who is also, unrelatedly, a member of the one being filtered for.
       and (
         (p_org is null or array_length(p_org, 1) is null)
         and (p_role is null or array_length(p_role, 1) is null)
         and (p_membership_status is null or array_length(p_membership_status, 1) is null)
         or exists (
              select 1
                from public.memberships m
               where m.user_id = p.id
                 and (p_org is null or array_length(p_org, 1) is null
                      or m.org_id = any (p_org))
                 and (p_role is null or array_length(p_role, 1) is null
                      or m.role = any (p_role))
                 and (p_membership_status is null
                      or array_length(p_membership_status, 1) is null
                      or m.status = any (p_membership_status))
            )
       )
       and (
         v_pattern is null
         or p.email ilike v_pattern
         or p.full_name ilike v_pattern
         -- Every organisation this account belongs to, not just the one it
         -- belongs to when it belongs to exactly one.
         or f.org_search ilike v_pattern
       )
  )
  select d.*, count(*) over () as total_count
    from directory d
   order by
     case when v_desc then null else
       case v_sort
         when 'name'   then lower(coalesce(d.full_name, d.email))
         when 'email'  then lower(d.email)
         when 'access' then coalesce(d.platform_role, 'zzz')
       end end asc nulls last,
     case when v_desc then
       case v_sort
         when 'name'   then lower(coalesce(d.full_name, d.email))
         when 'email'  then lower(d.email)
         when 'access' then coalesce(d.platform_role, 'zzz')
       end end desc nulls last,
     case when v_desc then null else
       case v_sort when 'organisations' then d.organisations end end asc nulls last,
     case when v_desc then
       case v_sort when 'organisations' then d.organisations end end desc nulls last,
     case when v_desc then null else
       case v_sort when 'created_at' then d.created_at end end asc nulls last,
     case when v_desc then
       case v_sort when 'created_at' then d.created_at end end desc nulls last,
     -- The tie-break, so paging an equal-valued sort neither repeats a row
     -- nor drops one.
     d.id asc
   limit v_limit offset v_offset;
end;
$$;

comment on function public.platform_user_directory(text, uuid[], text[], text[], text, text, text, integer, integer) is
  'One page of the platform user directory, filtered, sorted and counted in '
  'the database. Search covers EVERY organisation an account belongs to, not '
  'only the one it belongs to when it belongs to exactly one. One row per '
  'account. Operational platform roles only, mirroring 0122. See 0131.';

revoke execute on function public.platform_user_directory(text, uuid[], text[], text[], text, text, text, integer, integer)
  from public, anon;
grant execute on function public.platform_user_directory(text, uuid[], text[], text[], text, text, text, integer, integer)
  to authenticated;

-- ---------------------------------------------------------------------
-- The tiles above the table, over every account rather than the page.
-- ---------------------------------------------------------------------
create or replace function public.platform_user_facets()
returns table (
  total            bigint,
  with_membership  bigint,
  unattached       bigint,
  multi_org        bigint,
  platform_admins  bigint,
  suspended_only   bigint,
  roles            text[]
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_operational() then
    raise exception 'Only an operational platform role can read platform user facets'
      using errcode = '42501';
  end if;

  return query
  with facts as (
    select p.id,
           p.is_platform_admin,
           count(m.id)                                    as memberships,
           count(m.id) filter (where m.status = 'active')  as active_memberships
      from public.profiles p
      left join public.memberships m on m.user_id = p.id
     group by p.id, p.is_platform_admin
  )
  select
    count(*),
    count(*) filter (where f.memberships > 0),
    count(*) filter (where f.memberships = 0),
    count(*) filter (where f.memberships > 1),
    count(*) filter (where f.is_platform_admin),
    -- An account that belongs somewhere but is active nowhere. The console
    -- claimed to show this and could not: it tested `roles.length === 0`,
    -- and every membership row carries a role, so the badge was unreachable
    -- and every account read "Active".
    count(*) filter (where f.memberships > 0 and f.active_memberships = 0),
    coalesce((select array_agg(distinct m.role order by m.role)
                from public.memberships m), '{}')
    from facts f;
end;
$$;

comment on function public.platform_user_facets() is
  'Deployment-wide account counts and the organisation roles in use, for the '
  'tiles and filter options on /admin/users. Unfiltered on purpose: these '
  'describe the deployment, not the current view. See 0131.';

revoke execute on function public.platform_user_facets() from public, anon;
grant execute on function public.platform_user_facets() to authenticated;
