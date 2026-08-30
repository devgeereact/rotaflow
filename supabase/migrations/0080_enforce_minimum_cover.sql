-- =====================================================================
-- 0080_enforce_minimum_cover.sql — minimum cover is enforced where it is
-- decided, not only where it is displayed (docs/SAAS.md GAP-006)
--
-- `minimum_cover_rules` shipped in 0036 and `rotaInsights.ts` computes the
-- shortfall from it, marks it `critical`, and the Rota Builder refuses to
-- publish while one stands. That is the product's own stated rule: "a
-- critical issue cannot publish without resolution".
--
-- The rule lived entirely in the browser. `publish_rota` is an RPC that
-- any owner or manager can call directly, so a POST to
-- /rest/v1/rpc/publish_rota published an understaffed rota with nothing
-- to stop it — the register's recurring finding that a control whose only
-- enforcement is a disabled button is not a control.
--
-- ## This does not invent a policy, it makes an existing one real
--
-- The client already blocks. Anyone who publishes today has satisfied
-- this check; nobody's working practice changes. What changes is that the
-- check now also holds for a caller who never rendered the button.
--
-- ## COUNTING THE SAME WAY, which is the whole risk here
--
-- A server rule that disagrees with the warning on screen is worse than
-- no rule: the manager sees a green rota and gets an opaque refusal.
-- So this reproduces `rotaInsights.ts` exactly, and the ways it could
-- have drifted are worth naming.
--
--   * The date is the day the shift STARTS, in the LOCATION's timezone —
--     not UTC, and not the end date. A night shift starting 23:00 Monday
--     counts as Monday cover. `(starts_at at time zone l.timezone)::date`
--     is the same arithmetic `localDate(starts_at, timezoneFor(shift))`
--     does.
--   * DISTINCT staff, because two shifts for one person on one day are
--     one person of cover, not two.
--   * Cancelled shifts do not count. Unassigned ones do not either: the
--     client keys on `staff_profile_id` and skips rows without one.
--   * A shift that has already ENDED still counts. 0036's own comment
--     records why — filtering to `ends_at > now` read every fully staffed
--     site as critically understaffed each evening once the day shift
--     finished.
--   * Days already past are skipped. Nobody can fix yesterday, and
--     refusing to publish because of it would make a rota unpublishable
--     forever.
--   * `min_staff = 0` means no minimum, not "must be empty".
--
-- ## The escape hatch is the policy, not a bypass
--
-- A manager who genuinely cannot cover Saturday lowers Saturday's minimum
-- in Settings → Policies. That is a deliberate, visible, per-site decision
-- someone owns — which is what a minimum is for. There is no force flag,
-- because a flag that skips the check is the disabled button again with
-- extra steps.
--
-- MIGRATION RISK. One function replaced, same signature, so no grant
-- moves. It is strictly more restrictive, and the restriction is one the
-- UI has always applied — an organisation with no `minimum_cover_rules`
-- rows, which is every organisation that has never opened Settings →
-- Policies, is unaffected entirely.
-- =====================================================================

create or replace function public.publish_rota(p_rota_id uuid)
returns public.rotas language plpgsql security definer set search_path = public as $$
declare
  v_rota      public.rotas;
  v_published public.rotas;
  v_short     record;
begin
  select * into v_rota from public.rotas where id = p_rota_id;
  if not found then
    raise exception using errcode = 'ROTA4', message = 'Rota not found.';
  end if;

  if not public.has_org_role(v_rota.org_id, array['owner', 'manager']) then
    raise exception using
      errcode = '42501', message = 'Only an owner or manager can publish a rota.';
  end if;

  if v_rota.status = 'published' then
    return v_rota;
  end if;
  if v_rota.status <> 'draft' then
    raise exception using
      errcode = 'ROTA6', message = 'Only a draft rota can be published.';
  end if;

  -- ---------- minimum cover (0080) ----------------------------------
  -- The first shortfall, if any. Reported one day at a time because that
  -- is what a manager acts on, and named precisely enough to act without
  -- opening the Warnings tab.
  select l.name as location_name, d.day, r.min_staff, coalesce(c.on_shift, 0) as on_shift
    into v_short
    from public.minimum_cover_rules r
    join public.locations l on l.id = r.location_id
    -- Every date in the rota's period. A day with no shifts at all is a
    -- shortfall too, so this cannot be driven off the shifts table.
    cross join lateral (
      select generate_series(v_rota.period_start, v_rota.period_end, interval '1 day')::date as day
    ) d
    left join lateral (
      select count(distinct s.staff_profile_id) as on_shift
        from public.shifts s
       where s.rota_id = v_rota.id
         and s.location_id = r.location_id
         and s.staff_profile_id is not null
         and s.status <> 'cancelled'
         and (s.starts_at at time zone l.timezone)::date = d.day
    ) c on true
   where r.org_id = v_rota.org_id
     -- Only THIS rota's sites. Joining every rule in the organisation was the
     -- first version's bug, and its worst form was not the one the test caught
     -- (an org-wide rota judged against a site it has nothing to do with) but
     -- the ordinary one: Ward B being short would have blocked Ward A's rota.
     -- A rota covers one location, or carries its own shifts' locations.
     and (r.location_id = v_rota.location_id
          or exists (select 1 from public.shifts s2
                      where s2.rota_id = v_rota.id
                        and s2.location_id = r.location_id))
     and r.min_staff > 0
     and extract(dow from d.day)::smallint = r.weekday
     -- Yesterday cannot be fixed. Evaluated in the location's own timezone,
     -- for the same reason the shift date is.
     and d.day >= (timezone(l.timezone, now()))::date
     and coalesce(c.on_shift, 0) < r.min_staff
   order by d.day, l.name
   limit 1;

  if found then
    raise exception using
      errcode = 'ROTA7',
      message = format(
        '%s is %s short of its %s-person minimum on %s. Fill the gap, or change that day''s minimum in Settings → Policies.',
        v_short.location_name,
        v_short.min_staff - v_short.on_shift,
        v_short.min_staff,
        to_char(v_short.day, 'FMDay DD Mon')
      );
  end if;

  perform set_config('rotaflow.rota_transition', 'on', true);

  -- Archive the superseded original FIRST: rotas_published_unique_* would
  -- otherwise reject the new publication as a duplicate for the scope.
  if v_rota.supersedes_rota_id is not null then
    update public.rotas
       set status = 'archived', archived_at = timezone('utc', now())
     where id = v_rota.supersedes_rota_id
       and status = 'published';
  end if;

  update public.rotas
     set status = 'published',
         published_at = timezone('utc', now()),
         published_by = auth.uid(),
         supersedes_rota_id = v_rota.supersedes_rota_id
   where id = p_rota_id
  returning * into v_published;

  perform set_config('rotaflow.rota_transition', '', true);
  return v_published;
end;
$$;

comment on function public.publish_rota(uuid) is
  'Publishes a draft rota. Refuses when any day in its period is below that location''s minimum_cover_rules minimum (0080) — the same rule the Rota Builder enforces client-side, counted the same way: distinct assigned staff, by the day the shift starts in the location''s timezone, cancelled shifts excluded, past days skipped.';
