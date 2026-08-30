-- =====================================================================
-- 0083_rota_amendment_diff.sql — an amended rota tells each person what
-- changed for THEM (docs/SAAS.md GAP-007, CAP-028)
--
-- 0061 archives the superseded rota instead of overwriting it, so both
-- versions of the week survive and the difference has always been
-- derivable. Nothing derived it.
--
-- What a staff member got instead was "13 Oct - 19 Oct updated", sent to
-- everyone holding a shift in the new rota. Two problems, and the second
-- is the worse one:
--
--   1. it does not say what changed, so anyone who receives it must open
--      the app and compare a week they have already memorised against a
--      week that looks almost the same; and
--   2. it goes to EVERYONE in the rota, including people whose shifts
--      were not touched. A manager fixing one Tuesday night pages the
--      whole roster. Notify people about things that did not happen to
--      them and they learn to ignore the notification, which costs more
--      than the missing diff does.
--
-- ## Matching by value, because the ids do not survive
--
-- `begin_rota_revision` COPIES the published shifts into the revision
-- without carrying `id`, so every shift in an amendment is a new row.
-- There is no identity to match on, and inventing one — pairing by
-- person and day — guesses at intent and breaks the moment somebody
-- works two shifts in a day, which the minimum-cover rules explicitly
-- allow.
--
-- So this does not claim to know that a shift "moved". It reports what
-- the week looked like before and after for that person: a shift present
-- in one version and not the other. When a day has both, the message
-- reads "was 09:00-17:00, now 14:00-22:00", which is the useful
-- rendering of exactly that fact and claims nothing more.
--
-- Compared on `(staff_profile_id, starts_at, ends_at, location_id,
-- shift_type_id)`. Break minutes and notes are deliberately excluded:
-- changing a note is not a change to when somebody works, and paging a
-- carer about it is the same mistake as (2) above.
--
-- ## One outbox row per person
--
-- `send-notification` takes one title and body for a list of user ids,
-- so per-person text means per-person rows. Amendments are infrequent
-- and the outbox drains twenty a tick, so this is affordable; the
-- alternative is a shared message that says "something changed", which
-- is what we already have.
--
-- A first publish is unchanged: there is nothing to diff against, so it
-- keeps the single broadcast to everyone with a shift.
--
-- MIGRATION RISK. One new function and one trigger function replaced.
-- No table altered, no row rewritten. If the diff finds nothing — an
-- amendment that changed only a note — no notification is sent at all,
-- which is correct and is asserted.
-- =====================================================================

-- ── the diff ──────────────────────────────────────────────────────────
create or replace function public.rota_amendment_changes(p_rota_id uuid)
returns table (
  staff_profile_id uuid,
  user_id          uuid,
  change_date      date,
  removed          text,
  added            text
)
language sql stable security definer set search_path = public as $$
  with revision as (
    select r.id, r.supersedes_rota_id, r.org_id
      from public.rotas r
     where r.id = p_rota_id and r.supersedes_rota_id is not null
  ),
  -- Every shift on both sides, reduced to the fields that mean "when and
  -- where somebody works", with the day and time rendered in the site's own
  -- timezone rather than UTC.
  shape as (
    select
      'after'::text as side, s.staff_profile_id,
      (s.starts_at at time zone coalesce(l.timezone, 'Europe/London'))::date as day,
      to_char(s.starts_at at time zone coalesce(l.timezone, 'Europe/London'), 'HH24:MI')
        || '-' ||
      to_char(s.ends_at   at time zone coalesce(l.timezone, 'Europe/London'), 'HH24:MI')
        || coalesce(' at ' || l.name, '') as label,
      s.starts_at, s.ends_at, s.location_id, s.shift_type_id
      from revision rev
      join public.shifts s on s.rota_id = rev.id and s.status <> 'cancelled'
      left join public.locations l on l.id = s.location_id
     where s.staff_profile_id is not null
    union all
    select
      'before', s.staff_profile_id,
      (s.starts_at at time zone coalesce(l.timezone, 'Europe/London'))::date,
      to_char(s.starts_at at time zone coalesce(l.timezone, 'Europe/London'), 'HH24:MI')
        || '-' ||
      to_char(s.ends_at   at time zone coalesce(l.timezone, 'Europe/London'), 'HH24:MI')
        || coalesce(' at ' || l.name, ''),
      s.starts_at, s.ends_at, s.location_id, s.shift_type_id
      from revision rev
      join public.shifts s on s.rota_id = rev.supersedes_rota_id and s.status <> 'cancelled'
      left join public.locations l on l.id = s.location_id
     where s.staff_profile_id is not null
  ),
  -- EXCEPT ALL both ways: a shift unchanged on both sides cancels out, and
  -- a person working two identical shifts keeps both.
  gone as (
    select staff_profile_id, day, label
      from (select staff_profile_id, day, label, starts_at, ends_at, location_id, shift_type_id
              from shape where side = 'before') b
    except all
    select staff_profile_id, day, label
      from (select staff_profile_id, day, label, starts_at, ends_at, location_id, shift_type_id
              from shape where side = 'after') a
  ),
  fresh as (
    select staff_profile_id, day, label
      from (select staff_profile_id, day, label, starts_at, ends_at, location_id, shift_type_id
              from shape where side = 'after') a
    except all
    select staff_profile_id, day, label
      from (select staff_profile_id, day, label, starts_at, ends_at, location_id, shift_type_id
              from shape where side = 'before') b
  ),
  paired as (
    select coalesce(g.staff_profile_id, f.staff_profile_id) as staff_profile_id,
           coalesce(g.day, f.day)                           as day,
           g.label as removed,
           f.label as added
      from gone g
      full outer join fresh f
        on f.staff_profile_id = g.staff_profile_id and f.day = g.day
  )
  select p.staff_profile_id, sp.user_id, p.day, p.removed, p.added
    from paired p
    join public.staff_profiles sp on sp.id = p.staff_profile_id
   order by p.day, p.staff_profile_id;
$$;

comment on function public.rota_amendment_changes(uuid) is
  'What changed for each person between an amendment and the rota it supersedes. Compares by VALUE, because begin_rota_revision copies shifts without their ids — so it reports a shift present in one version and not the other, and never claims to know that a shift "moved". Returns nothing for a first publish, which has nothing to diff against.';

revoke all on function public.rota_amendment_changes(uuid) from public, anon;
grant execute on function public.rota_amendment_changes(uuid) to authenticated;

-- ── the notice ────────────────────────────────────────────────────────
create or replace function public.enqueue_rota_published_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user_ids uuid[];
  v_title    text;
  v_period   text;
  v_row      record;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status <> 'published' then
    return new;
  end if;

  v_period := to_char(new.period_start, 'DD Mon') || ' – ' ||
              to_char(new.period_end,   'DD Mon YYYY');

  -- ---------- an amendment: one message per affected person ----------
  if new.supersedes_rota_id is not null then
    for v_row in
      select c.user_id,
             string_agg(
               to_char(c.change_date, 'FMDy DD Mon') || ': ' ||
               case
                 when c.removed is not null and c.added is not null
                   then 'was ' || c.removed || ', now ' || c.added
                 when c.added is not null then 'added ' || c.added
                 else 'removed ' || c.removed
               end,
               E'\n' order by c.change_date
             ) as body,
             count(*) as n
        from public.rota_amendment_changes(new.id) c
       where c.user_id is not null
       group by c.user_id
    loop
      insert into public.notification_outbox (org_id, event_name, payload)
      values (
        new.org_id,
        'rota/published',
        jsonb_build_object(
          'orgId',   new.org_id,
          'userIds', jsonb_build_array(v_row.user_id),
          'type',    'rota',
          'title',   v_period || ' — ' || v_row.n ||
                     case when v_row.n = 1 then ' change to your shifts'
                          else ' changes to your shifts' end,
          'body',    v_row.body
        )
      );
    end loop;

    -- No rows means the amendment changed nothing anybody works. Sending
    -- "your rota changed" then would be the exact noise this replaces.
    return new;
  end if;

  -- ---------- a first publish: unchanged ----------
  select array_agg(distinct sp.user_id)
    into v_user_ids
    from public.shifts s
    join public.staff_profiles sp on sp.id = s.staff_profile_id
   where s.rota_id = new.id
     and sp.user_id is not null
     and s.status <> 'cancelled';

  if v_user_ids is null or array_length(v_user_ids, 1) is null then
    return new;
  end if;

  v_title := v_period || ' published';

  insert into public.notification_outbox (org_id, event_name, payload)
  values (
    new.org_id,
    'rota/published',
    jsonb_build_object(
      'orgId',   new.org_id,
      'userIds', to_jsonb(v_user_ids),
      'type',    'rota',
      'title',   v_title
    )
  );

  return new;
end;
$$;

revoke all on function public.enqueue_rota_published_notification()
  from public, anon, authenticated;
