-- =====================================================================
-- 0130_the_organisations_directory_is_one_server_query.sql — the platform
-- organisations directory filters, sorts, counts and pages in the
-- database instead of in the browser
--
-- ## The gap
--
-- `/admin/organisations` loaded four unbounded reads and did everything
-- else client-side:
--
--     listAllOrganisations()      select * from organisations
--     listAllSubscriptions()      select * from subscriptions
--     countMembershipsByOrg()     select org_id from memberships
--     countLocationsByOrg()       rpc, aggregate, fine
--
-- PostgREST caps a response at `db.max_rows` (1000 on Supabase's
-- defaults) and says nothing when it does. Every number and every
-- behaviour on that screen is computed from the returned array, so above
-- the cap:
--
--   * the tile reading "Organisations 1,000" is the cap, not the count;
--   * a search for a tenant created before the thousandth finds nothing,
--     and reports "No organisations match these filters", which is a
--     sentence about the filter rather than about the truncation;
--   * Export CSV writes the loaded page and labels it as the export;
--   * the Plan filter's option list is built from the loaded array, so a
--     plan only older tenants are on is not offered at all.
--
-- None of that is visible on this deployment, which has no tenant. It
-- becomes visible on the day it matters and not before, which is the
-- argument for fixing it while it is cheap.
--
-- ## Why one function and not a query per column
--
-- The screen needs, per row: the tenant, its subscription, its active
-- staff (the population `plans.seat_limit` is enforced on, `0070`), its
-- login accounts, its sites, its owner contact and a health band. Four
-- of those are aggregates over tables that `0028` put behind a
-- support-access session, which is why `platform_location_counts()`
-- (`0054`) and `platform_staff_counts()` (`0078`) already exist as
-- definer aggregates. Adding a third and a fourth of those, then joining
-- five results in the browser, is the same design that produced the bug:
-- a directory assembled from separately-truncated lists.
--
-- One definer function that filters, orders, pages and counts under the
-- *same* predicates is what makes "showing 21-40 of 137" and "export all
-- 137" true statements rather than hopeful ones. `count(*) over ()`
-- returns the total for the whole matching set on every page row, so the
-- page and its total cannot disagree.
--
-- ## Aggregate, never a row
--
-- The same line `0078` draws. Knowing an organisation has 248 active
-- staff needs no support session; knowing who they are does. Nothing
-- here returns a staff member, a shift, a location name or a membership
-- row — only counts of them.
--
-- ## The one thing that is role-scoped
--
-- `owner_email` and `owner_name` come from `memberships` joined to
-- `profiles`, and `0122` restricts both tables to
-- `is_platform_operational()` — owner, admin and support, but not
-- finance, whose documented scope is "no operational tenant data". A
-- definer function bypasses RLS, so it has to reproduce that boundary
-- itself or it becomes the hole in it. It returns null for finance and
-- sets `owner_contact_visible` to false, so the console can say "not
-- available to your role" instead of showing an empty cell that reads as
-- "this organisation has no owner". `organisations.contact_email` is a
-- different thing — the tenant's own billing contact, on the
-- organisation record, which `0122` deliberately left readable by
-- finance — and is returned to everyone.
--
-- ## The health band is now written twice, on purpose, and tested twice
--
-- `src/lib/tenantHealth.ts` decides the band in TypeScript. Filtering or
-- sorting by it in the database means the rule exists in SQL too. That
-- duplication is a real hazard and the alternative was worse: filtering
-- by health in the browser puts us straight back to "filter the page you
-- happened to load". `supabase/tests/database/platform_directory.test.sql`
-- asserts the SQL against the same case table `tenantHealth.test.ts`
-- asserts the TypeScript against, so the two cannot drift silently.
--
-- SAFETY(none): additive. Three new functions, no table altered, no row
-- rewritten, no policy changed, no grant widened beyond EXECUTE on the
-- new functions to `authenticated` — each of which refuses a caller who
-- is not a platform administrator before it reads anything.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The health band, in SQL. Mirrors healthBand() in src/lib/tenantHealth.ts.
--
-- Order matters and is the TypeScript's: suspended outranks everything,
-- a failed payment outranks a quiet month, and a tenant that has never
-- been active is at risk rather than healthy — a null is unobserved
-- health, and counting it as fine is how a dashboard reports health it
-- has not measured.
-- ---------------------------------------------------------------------
create or replace function public.platform_health_band(
  p_org_status          text,
  p_last_activity_at    timestamptz,
  p_subscription_status text,
  p_now                 timestamptz default timezone('utc', now())
)
returns text
language sql
immutable
as $$
  select case
    -- Archived is its own band, not a shade of suspended. Suspension is
    -- something the platform did to a live customer, usually over payment or
    -- abuse, and it is the row an administrator has to act on. An archived
    -- account is closed. Colouring the second as a failure puts a danger tone
    -- on a row needing nothing and buries the rows that need something.
    when p_org_status = 'archived'                             then 'archived'
    when p_org_status is not null and p_org_status <> 'active' then 'suspended'
    when p_subscription_status = 'past_due'                    then 'attention'
    when p_last_activity_at is null                            then 'at_risk'
    when p_now - p_last_activity_at > interval '30 days'        then 'at_risk'
    when p_now - p_last_activity_at > interval '14 days'        then 'attention'
    else 'healthy'
  end;
$$;

comment on function public.platform_health_band(text, timestamptz, text, timestamptz) is
  'Tenant health band. The SQL half of src/lib/tenantHealth.ts healthBand(); '
  'the two are asserted against the same case table by '
  'supabase/tests/database/platform_directory.test.sql. Never-active is at_risk, '
  'not healthy. See 0130.';

revoke execute on function public.platform_health_band(text, timestamptz, text, timestamptz)
  from public, anon;
grant execute on function public.platform_health_band(text, timestamptz, text, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------
-- The directory itself. One page of rows, plus the total for the whole
-- matching set on every one of them.
-- ---------------------------------------------------------------------
create or replace function public.platform_organisation_directory(
  p_search              text        default null,
  p_status              text[]      default null,
  p_plan                text[]      default null,
  p_subscription_status text[]      default null,
  p_industry            text[]      default null,
  p_health              text[]      default null,
  p_created_from        timestamptz default null,
  p_created_to          timestamptz default null,
  p_sort                text        default 'created_at',
  p_direction           text        default 'desc',
  p_limit               integer     default 25,
  p_offset              integer     default 0
)
returns table (
  id                      uuid,
  name                    text,
  slug                    text,
  status                  text,
  plan                    text,
  industry                text,
  contact_email           text,
  contact_phone           text,
  country                 text,
  timezone                text,
  is_demo                 boolean,
  created_at              timestamptz,
  last_activity_at        timestamptz,
  onboarding_completed_at timestamptz,
  support_access_allowed  boolean,
  suspended_at            timestamptz,
  suspended_reason        text,
  subscription_status     text,
  subscription_plan       text,
  subscription_currency   text,
  subscription_price_pence integer,
  trial_ends_at           timestamptz,
  current_period_end      timestamptz,
  members                 bigint,
  staff_active            bigint,
  locations               bigint,
  owner_email             text,
  owner_name              text,
  owner_contact_visible   boolean,
  health                  text,
  total_count             bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now        timestamptz := timezone('utc', now());
  v_operational boolean;
  v_pattern    text;
  v_limit      integer;
  v_offset     integer;
  v_sort       text;
  v_desc       boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform staff can read the organisation directory'
      using errcode = '42501';
  end if;

  v_operational := public.is_platform_operational();

  -- Bounded here rather than trusted from the caller: an unbounded page is
  -- the unbounded read this function exists to remove.
  v_limit  := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  -- Whitelisted. A sort key is an identifier, and an identifier taken from
  -- a query string is how an ORDER BY becomes an injection point. Anything
  -- unrecognised falls back rather than raising: a stale bookmark should
  -- show the default order, not an error page.
  v_sort := case coalesce(p_sort, '')
              when 'name'                then 'name'
              when 'status'              then 'status'
              when 'plan'                then 'plan'
              when 'subscription_status' then 'subscription_status'
              when 'industry'            then 'industry'
              when 'members'             then 'members'
              when 'staff_active'        then 'staff_active'
              when 'locations'           then 'locations'
              when 'last_activity_at'    then 'last_activity_at'
              when 'health'              then 'health'
              else 'created_at'
            end;
  v_desc := lower(coalesce(p_direction, 'desc')) = 'desc';

  -- `%` and `_` are ilike wildcards. A tenant searching for `50_%` means
  -- those characters; unescaped they match everything. The backslash goes
  -- first or it escapes the escapes.
  v_pattern := case
    when p_search is null or btrim(p_search) = '' then null
    else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  return query
  with owner_contact as (
    -- One owner per organisation, the earliest joined, so a tenant with two
    -- owners still produces one row and the same one every time. Skipped
    -- entirely for a role that may not see it, rather than computed and
    -- discarded.
    select distinct on (m.org_id)
           m.org_id,
           p.email     as owner_email,
           p.full_name as owner_name
      from public.memberships m
      join public.profiles p on p.id = m.user_id
     where v_operational
       and m.role = 'owner'
       and m.status = 'active'
     order by m.org_id, m.created_at asc
  ),
  member_counts as (
    select m.org_id, count(*) as members
      from public.memberships m
     where m.status = 'active'
     group by m.org_id
  ),
  staff_counts as (
    -- `active` only: the population 0070's trigger enforces seat_limit on.
    select s.org_id, count(*) as staff_active
      from public.staff_profiles s
     where s.active is true
     group by s.org_id
  ),
  location_counts as (
    select l.org_id, count(*) as locations
      from public.locations l
     group by l.org_id
  ),
  directory as (
    select
      o.id,
      o.name,
      o.slug,
      o.status,
      -- The subscription's plan is the billed one and wins where it exists;
      -- `organisations.plan` is the fallback for a tenant that has never
      -- had a subscription row. Same precedence the console already used.
      coalesce(s.plan, o.plan)                                  as plan,
      o.industry,
      o.contact_email,
      o.contact_phone,
      o.country,
      o.timezone,
      o.is_demo,
      o.created_at,
      o.last_activity_at,
      o.onboarding_completed_at,
      o.support_access_allowed,
      o.suspended_at,
      o.suspended_reason,
      s.status                                                  as subscription_status,
      s.plan                                                    as subscription_plan,
      s.currency                                                as subscription_currency,
      s.price_pence                                             as subscription_price_pence,
      s.trial_ends_at,
      s.current_period_end,
      coalesce(mc.members, 0)                                   as members,
      coalesce(sc.staff_active, 0)                              as staff_active,
      coalesce(lc.locations, 0)                                 as locations,
      oc.owner_email,
      oc.owner_name,
      v_operational                                             as owner_contact_visible,
      public.platform_health_band(o.status, o.last_activity_at, s.status, v_now) as health
      from public.organisations o
      left join public.subscriptions s on s.org_id = o.id
      left join member_counts   mc on mc.org_id = o.id
      left join staff_counts    sc on sc.org_id = o.id
      left join location_counts lc on lc.org_id = o.id
      left join owner_contact   oc on oc.org_id = o.id
     where (p_status is null   or array_length(p_status, 1)   is null or o.status = any (p_status))
       and (p_industry is null or array_length(p_industry, 1) is null or o.industry = any (p_industry))
       and (p_plan is null     or array_length(p_plan, 1)     is null
            or coalesce(s.plan, o.plan) = any (p_plan))
       and (p_subscription_status is null
            or array_length(p_subscription_status, 1) is null
            -- 'none' is selectable: a tenant with no subscription row is a
            -- real and interesting state, and it cannot be found by picking
            -- one of the four statuses.
            or coalesce(s.status, 'none') = any (p_subscription_status))
       and (p_health is null or array_length(p_health, 1) is null
            or public.platform_health_band(o.status, o.last_activity_at, s.status, v_now)
               = any (p_health))
       and (p_created_from is null or o.created_at >= p_created_from)
       and (p_created_to   is null or o.created_at <  p_created_to)
       and (
         v_pattern is null
         or o.name  ilike v_pattern
         or o.slug  ilike v_pattern
         or o.contact_email ilike v_pattern
         -- Owner contact is searchable only by a role that may see it. A
         -- role that cannot read the value must not be able to confirm it
         -- by watching the result count move.
         or (v_operational and (oc.owner_email ilike v_pattern
                                or oc.owner_name ilike v_pattern))
       )
  )
  select r.*, count(*) over () as total_count
    from directory r
   order by
     -- Ordering is expressed as parallel ASC/DESC pairs rather than built
     -- as a string and EXECUTEd: no identifier from the caller reaches the
     -- plan, and the planner still sees a real ORDER BY.
     case when v_desc then null else
       case v_sort
         when 'name'   then lower(r.name)
         when 'status' then r.status
         when 'plan'   then r.plan
         when 'subscription_status' then coalesce(r.subscription_status, 'none')
         when 'industry' then coalesce(r.industry, '')
         when 'health' then r.health
       end end asc nulls last,
     case when v_desc then
       case v_sort
         when 'name'   then lower(r.name)
         when 'status' then r.status
         when 'plan'   then r.plan
         when 'subscription_status' then coalesce(r.subscription_status, 'none')
         when 'industry' then coalesce(r.industry, '')
         when 'health' then r.health
       end end desc nulls last,
     case when v_desc then null else
       case v_sort
         when 'members'      then r.members
         when 'staff_active' then r.staff_active
         when 'locations'    then r.locations
       end end asc nulls last,
     case when v_desc then
       case v_sort
         when 'members'      then r.members
         when 'staff_active' then r.staff_active
         when 'locations'    then r.locations
       end end desc nulls last,
     case when v_desc then null else
       case v_sort
         when 'last_activity_at' then r.last_activity_at
         when 'created_at'       then r.created_at
       end end asc nulls last,
     case when v_desc then
       case v_sort
         when 'last_activity_at' then r.last_activity_at
         when 'created_at'       then r.created_at
       end end desc nulls last,
     -- The tie-break. Two rows that compare equal are free to swap between
     -- pages, so one is read twice and another never; a unique key at the
     -- end of every sort is what stops that.
     r.id asc
   limit v_limit offset v_offset;
end;
$$;

comment on function public.platform_organisation_directory(text, text[], text[], text[], text[], text[], timestamptz, timestamptz, text, text, integer, integer) is
  'One page of the platform organisations directory, filtered, sorted and '
  'counted in the database. total_count is the whole matching set, so a page '
  'and its total cannot disagree. Aggregates only — no staff, shift or '
  'location row crosses the boundary. Owner contact is returned only to an '
  'operational platform role (0122). See 0130.';

revoke execute on function public.platform_organisation_directory(text, text[], text[], text[], text[], text[], timestamptz, timestamptz, text, text, integer, integer)
  from public, anon;
grant execute on function public.platform_organisation_directory(text, text[], text[], text[], text[], text[], timestamptz, timestamptz, text, text, integer, integer)
  to authenticated;

-- ---------------------------------------------------------------------
-- Deployment-wide facets: the tiles above the table, and the values the
-- filter selects offer.
--
-- Separate from the directory on purpose. The tiles describe the estate,
-- not the current filter, and an option list built from the loaded page
-- cannot offer a plan that only older tenants are on — which is the same
-- truncation bug one level down.
-- ---------------------------------------------------------------------
create or replace function public.platform_organisation_facets()
returns table (
  total            bigint,
  active           bigint,
  suspended        bigint,
  archived         bigint,
  new_this_month   bigint,
  new_last_month   bigint,
  trialing         bigint,
  past_due         bigint,
  healthy          bigint,
  attention        bigint,
  at_risk          bigint,
  archived_band    bigint,
  -- Tenants that did something in the last 24 hours. TENANTS, not people:
  -- nothing records a per-person session, so "active users today" is not
  -- derivable at all and the tile that used to claim it now counts
  -- organisations, which is a different and true thing.
  active_24h       bigint,
  plans            text[],
  industries       text[],
  subscription_statuses text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now         timestamptz := timezone('utc', now());
  v_this_month  timestamptz := date_trunc('month', timezone('utc', now()));
  v_last_month  timestamptz := date_trunc('month', timezone('utc', now())) - interval '1 month';
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform staff can read platform facets'
      using errcode = '42501';
  end if;

  return query
  with joined as (
    select o.id,
           o.status,
           o.industry,
           o.created_at,
           o.last_activity_at,
           coalesce(s.plan, o.plan)     as plan,
           coalesce(s.status, 'none')   as sub_status,
           public.platform_health_band(o.status, o.last_activity_at, s.status, v_now) as health
      from public.organisations o
      left join public.subscriptions s on s.org_id = o.id
  )
  select
    count(*),
    count(*) filter (where j.status = 'active'),
    count(*) filter (where j.status = 'suspended'),
    count(*) filter (where j.status = 'archived'),
    count(*) filter (where j.created_at >= v_this_month),
    count(*) filter (where j.created_at >= v_last_month and j.created_at < v_this_month),
    count(*) filter (where j.sub_status = 'trialing'),
    count(*) filter (where j.sub_status = 'past_due'),
    count(*) filter (where j.health = 'healthy'),
    count(*) filter (where j.health = 'attention'),
    count(*) filter (where j.health = 'at_risk'),
    count(*) filter (where j.health = 'archived'),
    count(*) filter (where j.last_activity_at >= v_now - interval '24 hours'),
    coalesce(array_agg(distinct j.plan) filter (where j.plan is not null), '{}'),
    coalesce(array_agg(distinct j.industry) filter (where j.industry is not null), '{}'),
    coalesce(array_agg(distinct j.sub_status), '{}')
    from joined j;
end;
$$;

comment on function public.platform_organisation_facets() is
  'Estate-wide organisation counts and the distinct values the directory '
  'filters offer. Deliberately unfiltered: these describe the deployment, not '
  'the current view, and an option list built from a loaded page cannot offer '
  'a value only older tenants hold. See 0130.';

revoke execute on function public.platform_organisation_facets() from public, anon;
grant execute on function public.platform_organisation_facets() to authenticated;
