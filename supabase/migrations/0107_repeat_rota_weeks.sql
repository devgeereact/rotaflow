-- =====================================================================
-- 0107_repeat_rota_weeks.sql — a week that repeats (docs/SAAS.md CAP-006)
--
-- The builder has copy-previous-week and a single duplicate, so building
-- a quarter means twelve identical rounds of copy, navigate, paste. A
-- rota is the most repetitive document in this product — most teams work
-- the same shape of week for months — and repeating it was the one thing
-- the builder made a manager do by hand, every week, forever.
--
-- ## Why this is one function and not a loop in the browser
--
-- The client already has the machinery: `pasteShifts` walks a week and
-- calls `createShift` per row. Repeating twelve weeks that way is
-- twelve rota creations and several hundred round trips, each of which
-- can fail on its own, leaving a quarter half-built with no record of
-- where it stopped. Here it is one statement per week inside one
-- transaction: it either happens or it does not.
--
-- ## What it refuses, and what it skips
--
-- REFUSED: a source rota the caller cannot manage, and a repeat count
-- outside 1–26. Twenty-six weeks is half a year, which is already
-- further ahead than any real rota is planned; an unbounded count is a
-- way to write tens of thousands of rows from one click.
--
-- SKIPPED, and reported: a target week that already has a PUBLISHED
-- rota. Staff are working to it, `0061` refuses the write, and quietly
-- dropping those shifts would leave a manager believing a week was
-- filled. The count comes back so the screen can say which.
--
-- Also skipped: a target week that already has a draft with shifts in
-- it. Repeating onto work somebody has already started is how you get
-- two of every shift, and the manager did not ask to merge.
--
-- ## Times move by whole weeks IN THE SITE'S OWN TIMEZONE
--
-- `starts_at + interval '7 days'` on a `timestamptz` is evaluated in the
-- session timezone, which on this project is UTC — so across the March
-- and October clock changes it would move a 07:00 shift to 08:00 or
-- 06:00. Repeating twelve weeks in February would silently shift every
-- shift after the last Sunday in March by an hour, which is the kind of
-- wrong nobody notices until somebody turns up late.
--
-- So the arithmetic is done in the location's own timezone and converted
-- back. A shift with no location falls back to UTC, where a week really
-- is 168 hours and there is no local clock to preserve.
-- =====================================================================

create or replace function public.repeat_rota_weeks(p_rota uuid, p_weeks integer)
returns table (
  weeks_created  integer,
  shifts_created integer,
  weeks_skipped  integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source   public.rotas%rowtype;
  v_week     integer;
  v_start    date;
  v_end      date;
  v_target   uuid;
  v_existing public.rotas%rowtype;
  v_made     integer := 0;
  v_shifts   integer := 0;
  v_skipped  integer := 0;
  v_added    integer;
begin
  select * into v_source from public.rotas where id = p_rota;
  if not found then
    raise exception 'That rota no longer exists' using errcode = 'P0002';
  end if;

  if not public.has_org_role(v_source.org_id, array['owner', 'manager']) then
    raise exception 'Only an owner or manager may repeat a rota' using errcode = '42501';
  end if;

  if p_weeks is null or p_weeks < 1 or p_weeks > 26 then
    raise exception 'Repeat between 1 and 26 weeks' using errcode = '22023';
  end if;

  for v_week in 1..p_weeks loop
    v_start := v_source.period_start + (7 * v_week);
    v_end   := v_source.period_end   + (7 * v_week);

    -- Is anything already standing in that week?
    select * into v_existing
      from public.rotas r
     where r.org_id = v_source.org_id
       and r.period_start = v_start
       and r.period_end = v_end
       and r.location_id is not distinct from v_source.location_id
       and r.status in ('draft', 'published')
     order by case r.status when 'published' then 0 else 1 end
     limit 1;

    if found then
      -- Published: staff are working to it. `0061` would refuse the write
      -- anyway; refusing here means the count is honest rather than the
      -- transaction dying halfway.
      if v_existing.status = 'published' then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      -- A draft with work already in it. Merging was not asked for, and two
      -- of every shift is the worst possible answer.
      if exists (select 1 from public.shifts s where s.rota_id = v_existing.id) then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      v_target := v_existing.id;
    else
      insert into public.rotas (org_id, location_id, name, period_start, period_end, status)
      values (
        v_source.org_id,
        v_source.location_id,
        -- Named for its week rather than "Copy of…", because that is what a
        -- manager will look for in a list six weeks from now.
        'Week of ' || to_char(v_start, 'DD Mon YYYY'),
        v_start, v_end, 'draft')
      returning id into v_target;
      v_made := v_made + 1;
    end if;

    insert into public.shifts (
      org_id, rota_id, location_id, department_id, staff_profile_id, shift_type_id,
      starts_at, ends_at, break_minutes, status, colour, notes)
    select
      s.org_id, v_target, s.location_id, s.department_id, s.staff_profile_id,
      s.shift_type_id,
      -- Whole weeks in the site's own timezone, so a 07:00 shift is still
      -- 07:00 after the clocks change. Doing this in UTC would move it.
      (timezone(coalesce(l.timezone, 'UTC'), s.starts_at)
        + (7 * v_week || ' days')::interval)
        at time zone coalesce(l.timezone, 'UTC'),
      (timezone(coalesce(l.timezone, 'UTC'), s.ends_at)
        + (7 * v_week || ' days')::interval)
        at time zone coalesce(l.timezone, 'UTC'),
      s.break_minutes,
      -- A cancelled shift is not repeated at all; anything else comes across
      -- as it stands, assignment included. Repeating an assigned shift
      -- unassigned would make the feature useless for the case it exists for.
      s.status, s.colour, s.notes
      from public.shifts s
      left join public.locations l on l.id = s.location_id
     where s.rota_id = p_rota
       and s.status <> 'cancelled';

    get diagnostics v_added = row_count;
    v_shifts := v_shifts + v_added;
  end loop;

  perform public.audit_write(
    v_source.org_id, 'rota.repeated', 'rotas', p_rota,
    jsonb_build_object('weeks', p_weeks, 'shifts_created', v_shifts, 'weeks_skipped', v_skipped),
    'info');

  return query select v_made, v_shifts, v_skipped;
end;
$$;

comment on function public.repeat_rota_weeks(uuid, integer) is
  'Copies a rota''s shifts into the following N weeks, in one transaction. Skips a week that already has a published rota or a draft with work in it, and reports how many (CAP-006).';

revoke all on function public.repeat_rota_weeks(uuid, integer) from public, anon;
grant execute on function public.repeat_rota_weeks(uuid, integer) to authenticated;
