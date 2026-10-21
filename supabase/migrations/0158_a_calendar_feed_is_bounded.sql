-- =====================================================================
-- 0158_a_calendar_feed_is_bounded.sql: a calendar feed nobody reads stops
-- working, and one read too often is refused (docs/SAAS.md GAP-052)
--
-- `0099` made the feed URL the credential, because a calendar client cannot
-- present a header. It chose not to expire the token on a timer, and that
-- choice stands: a feed that expires on a date silently stops updating on
-- somebody's phone, which is the stale-snapshot failure the feed exists to
-- end. GAP-052 found two things that choice did not cover.
--
-- ## 1. A forgotten URL lived for ever
--
-- `last_used_at` was written on every read and nothing read it. A URL pasted
-- into a support ticket, or left in a calendar that was later deleted, stayed
-- a working credential indefinitely.
--
-- So the expiry is on IDLENESS, not age. A token that no calendar has read for
-- 90 days (counted from issue, for one never read at all) stops returning
-- shifts, and the first read after that marks it revoked so the person's
-- account screen agrees. A calendar that is actually subscribed reads the feed
-- at least daily, so it never comes near the limit; the only feeds this ends
-- are the ones nobody is using. The person rotates or re-issues from "My rota"
-- (Subscribe, or Reset link), exactly as before.
--
-- 90 days lives in two places: here, and `FEED_IDLE_DAYS` in
-- `src/lib/calendarFeed.ts`, which decides what the account screen shows.
-- `src/lib/calendarFeed.test.ts` names this migration so a change to one is a
-- visible change to both.
--
-- ## 2. Nothing limited the endpoint
--
-- The function is deployed `--no-verify-jwt` (a calendar client presents no
-- JWT), so nothing in front of it counted requests. Each read is a token
-- lookup and a 210-day shift query.
--
-- The limit reuses `consume_rate_limit` (`0085`) rather than adding a second
-- mechanism: 120 reads an hour per staff record, keyed on the staff profile,
-- never on the token, so the credential is not copied into a second table. A
-- real subscription reads a few times an hour at most, even shared across
-- several devices; a script reading in a loop is refused with P0001, which
-- the Edge Function answers with 429 and a Retry-After.
--
-- Unknown and revoked tokens are not counted: they reach no shift data, cost
-- one primary-key lookup, and counting them would mean storing whatever junk a
-- caller sends. A UUID token cannot be guessed (122 random bits).
--
-- ## What is unchanged
--
-- The token still travels in the query string, so it still appears in
-- platform request logs and wherever the person pastes it. That is the price
-- of a calendar client being unable to send a header, and the reason the
-- token reads one person's own published shifts and nothing more.
--
-- `create or replace` with the same signature, so the grants `0099` and
-- `0113` set (service_role only) are kept as they are.
--
-- pgTAP: supabase/tests/database/calendar_feed.test.sql.
-- =====================================================================

create or replace function public.calendar_feed_shifts(p_token uuid)
returns table (
  shift_id      uuid,
  starts_at     timestamptz,
  ends_at       timestamptz,
  shift_type    text,
  location_name text,
  break_minutes integer,
  notes         text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff     uuid;
  v_last_seen timestamptz;
begin
  select t.staff_profile_id, coalesce(t.last_used_at, t.created_at)
    into v_staff, v_last_seen
    from public.calendar_feed_tokens t
   where t.token = p_token and t.revoked_at is null;

  if v_staff is null then
    return;  -- Unknown or revoked. No rows, and no clue which.
  end if;

  -- Idle for 90 days: nobody's calendar is reading this URL, so it is a
  -- leftover rather than a subscription. Revoke it so the account screen
  -- shows no feed, and return nothing, as for any revoked token.
  if v_last_seen < timezone('utc', now()) - interval '90 days' then
    update public.calendar_feed_tokens
       set revoked_at = timezone('utc', now())
     where token = p_token and revoked_at is null;
    return;
  end if;

  -- Raises P0001 over the limit, which rolls back this call (so a refused
  -- read neither counts nor refreshes `last_used_at`).
  perform public.consume_rate_limit(
    'calendar_feed', v_staff::text, 120, interval '1 hour');

  update public.calendar_feed_tokens
     set last_used_at = timezone('utc', now())
   where token = p_token;

  return query
  select s.id,
         s.starts_at,
         s.ends_at,
         st.name,
         l.name,
         coalesce(s.break_minutes, 0),
         s.notes
    from public.shifts s
    join public.rotas r on r.id = s.rota_id
    left join public.shift_types st on st.id = s.shift_type_id
    left join public.locations l on l.id = s.location_id
   where s.staff_profile_id = v_staff
     and s.status <> 'cancelled'
     and r.status = 'published'
     and s.starts_at > timezone('utc', now()) - interval '30 days'
     and s.starts_at < timezone('utc', now()) + interval '180 days'
   order by s.starts_at;
end;
$$;

comment on function public.calendar_feed_shifts(uuid) is
  'The published shifts one feed token may see. service_role only. A token idle for 90 days is revoked on its next read and returns nothing; more than 120 reads an hour per staff record raise P0001 (GAP-052, 0158).';
