-- =====================================================================
-- Demo minimum-cover rules
--
-- 0036_minimum_cover_rules.sql adds the table; this fills it in for the five
-- live demo organisations (demo_seed.sql) so the rota builder's publish gate
-- and the manager dashboard's "Cover against minimum" chart have something
-- real to show, instead of reading as unconfigured everywhere.
--
-- Not a migration. Data, like demo_seed.sql, so it lives here and is safe to
-- re-run: it only ever touches organisations flagged `is_demo = true`
-- (0035_demo_organisations.sql), and upserts rather than duplicates.
--
-- ## Why derived from the seeded rota, not a flat guess
--
-- A flat "6 required everywhere" would show a healthy chart on a small site
-- and a permanently-red one on a five-person site, neither of which says
-- anything about that site. Instead each site's minimum is set from the
-- rota demo_seed.sql already built for it: one below its own typical
-- weekday headcount. That keeps most days green, the way a manager who set
-- a sane minimum would see, and lets demo_seed.sql's own planted shortfalls
-- (README.md "The planted problems", item a: weekend nights and twilights on
-- sites 2 and 4) show up on the cover chart as real, not synthetic, shortfalls.
-- =====================================================================

with typical_headcount as (
  select
    s.org_id,
    s.location_id,
    extract(dow from s.starts_at)::int as weekday,
    -- Distinct people on shift that day, averaged over every week the demo
    -- built for that site. round() before floor() so a 3.5 rounds up to a
    -- minimum of 3 (round-half-up then -1), not down to 2.
    round(avg(daily.headcount))::int as avg_headcount
  from public.shifts s
  join public.organisations o on o.id = s.org_id and o.is_demo
  join lateral (
    select count(distinct s2.staff_profile_id) as headcount
    from public.shifts s2
    where s2.org_id = s.org_id
      and s2.location_id = s.location_id
      and s2.status <> 'cancelled'
      and s2.staff_profile_id is not null
      and date_trunc('day', s2.starts_at) = date_trunc('day', s.starts_at)
  ) daily on true
  where s.status <> 'cancelled'
  group by s.org_id, s.location_id, extract(dow from s.starts_at)
)
insert into public.minimum_cover_rules (org_id, location_id, weekday, min_staff)
select
  org_id,
  location_id,
  weekday,
  -- One below the site's own typical headcount for that weekday, floored at
  -- 1: a minimum of 0 is indistinguishable from "not set" (see 0036's
  -- comment), and this table only ever holds rows for a weekday a site
  -- actually rosters.
  greatest(1, avg_headcount - 1)
from typical_headcount
where avg_headcount > 0
on conflict (location_id, weekday)
  do update set min_staff = excluded.min_staff;

-- Verification: one row per demo org, how many site/weekday rules it now has
-- and the min/max minimum set, so a re-run's effect is visible immediately.
select
  o.name as organisation,
  count(*) as rules_set,
  min(r.min_staff) as smallest_minimum,
  max(r.min_staff) as largest_minimum
from public.minimum_cover_rules r
join public.organisations o on o.id = r.org_id
where o.is_demo
group by o.name
order by o.name;
