-- =====================================================================
-- 0115_clock_event_sequence_guard.sql — a second clock-in is not a
-- clock-in (docs/SAAS.md GAP-040, CAP-015)
--
-- ## What was wrong
--
-- Nothing on the server stopped a staff member sending two consecutive
-- `in` events, or an `out` with nothing open. The only thing preventing
-- it was `clockStage()` in `src/lib/clockRows.ts:130-142` deciding which
-- button to render, and a disabled button is not a control — this
-- repository says so in `CLAUDE.md` and has had to learn it three times
-- already (plan limits `0070`, the AI entitlement `0074`, minimum cover
-- `0080`).
--
-- Verified against a local stack on 2026-09-02, as `authenticated` with
-- the staff member's own `sub` claim:
--
--   three `in` rows in a row, no `out` between  -> all three accepted
--   an `out` for someone with nothing open      -> accepted
--
-- The idempotency indexes from `0081` do not cover this. They stop the
-- SAME event being replayed twice, which is a different thing from two
-- genuine events that should not both exist.
--
-- ## Why it matters more than it looks
--
-- `pairClockEvents` (`src/lib/hours.ts:113-121`) already absorbs the
-- mess: a second `in` while one is open emits a zero-minute segment
-- flagged `missing_clock_out`. So the damage is not a crash, it is a
-- timesheet that reads as a shift worked for no time, on a screen a
-- manager approves for payroll. The audit standard lists duplicate
-- clock-in and "incorrect attendance record" as release blockers, and
-- this is how you get one without anybody doing anything unusual: a
-- double-tap on a cold phone, or an offline queue flushed twice.
--
-- ## The rule, and everything it deliberately does NOT do
--
--   an `in` is refused when an `in` is already open and was recorded
--   within the five minutes before it
--
-- That is the whole rule, and each half of it was arrived at by trying
-- something stricter and watching it break a real path.
--
-- **Why not "refuse any `in` while a session is open".** Because the
-- session may be open for the ordinary reason: somebody forgot to clock
-- out last night. Refusing their `in` this morning strands them, and the
-- timesheet already handles that case honestly — `pairClockEvents`
-- (`src/lib/hours.ts:113-121`) emits a segment flagged
-- `missing_clock_out` for a manager to correct. A worker at the door of
-- their shift is the wrong person to make pay for it. Five minutes is
-- long enough to cover a double-tap on a cold screen and a second device,
-- and short enough that it can never be a real shift.
--
-- **Why nothing guards `out` at all.** The first version of this
-- migration also refused an `out` with nothing open, and the existing
-- suite rejected it within a minute: `clock_event_reported_time.test.sql`
-- has an offline `in` from four days ago, which `0068` CLAMPS to now(),
-- landing it AFTER an `out` submitted two minutes ago. The clamp reorders
-- events, so any ordering rule applied to `out` can refuse a genuine one.
-- The audit standard this came from puts it plainly: a person must never
-- become unable to clock out because of a recoverable condition. An
-- orphan `out` costs a flagged segment; a refused `out` costs somebody
-- their evening and their hours. Guard the fabrication, never the exit.
--
-- Ordered by `event_at`, never by insertion order, because this app
-- queues clock events offline (`src/lib/offlineOutbox.ts`) and a flush
-- can deliver yesterday's rows after today's.
--
-- Two exemptions, both deliberate:
--
--   * Owners and managers. Amending attendance is their job, `0037`
--     already gates it, and a manager correcting a missed clock-out has
--     to be able to insert the very row this guard would refuse. Same
--     exemption, and same reasoning, as `clock_events_guard_event_at`.
--
--   * A row carrying a `client_event_id` that is already present. That
--     is a replay, and `0081`'s partial unique index is what should
--     answer it, with the 23505 that `isAlreadyApplied`
--     (`src/services/syncQueue.ts:150-160`) recognises as "already
--     landed, mark it synced". Raising here instead would turn a
--     successful retry into a dead letter, and dead letters are shown to
--     the person as "this did not happen, do it again" — which for a
--     clock-in that DID land is the worst answer available.
--
-- The trigger name sorts after `clock_events_guard_event_at`, which
-- matters: same table, same timing, and Postgres fires BEFORE triggers in
-- name order, so the clamp has already normalised `event_at` by the time
-- this reads it.
--
-- `CLK01` is outside the transient classes `classifyFailure` retries
-- (`08, 40, 53, 57, 58`), so a genuine double-clock is dead-lettered and
-- shown to the person rather than retried five times and then shown to
-- them anyway.
--
-- Guarded by `clock_event_sequence.test.sql`.
-- =====================================================================

create or replace function public.clock_events_guard_sequence()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_previous text;
begin
  -- A manager amending attendance is not the case this guards.
  if public.has_org_role(new.org_id, array['owner', 'manager']) then
    return new;
  end if;

  -- A replay of a write that already landed. Let 0081's unique index
  -- answer it with 23505, which the outbox reads as "already applied".
  if new.client_event_id is not null
     and exists (
       select 1 from public.clock_events c
        where c.client_event_id = new.client_event_id
     ) then
    return new;
  end if;

  select c.type into v_previous
    from public.clock_events c
   where c.staff_profile_id = new.staff_profile_id
     and c.org_id = new.org_id
     and c.event_at <= new.event_at
     and c.event_at >  new.event_at - interval '5 minutes'
   order by c.event_at desc, c.created_at desc
   limit 1;

  if new.type = 'in' and v_previous = 'in' then
    raise exception using
      errcode = 'CLK01',
      message = 'You are already clocked in.',
      hint    = 'If this is a second shift, clock out of the first one first.';
  end if;

  return new;
end;
$$;

revoke all on function public.clock_events_guard_sequence() from public, anon, authenticated;

drop trigger if exists clock_events_guard_sequence on public.clock_events;
create trigger clock_events_guard_sequence
  before insert on public.clock_events
  for each row execute function public.clock_events_guard_sequence();

-- The lookup the guard does on every staff-side insert. `clock_events`
-- already indexes (org_id, event_at) and (staff_profile_id, event_at)
-- is what this needs; adding it is cheaper than the sequential scan a
-- busy site would otherwise do once per clock-in.
create index if not exists clock_events_staff_event_at_idx
  on public.clock_events (staff_profile_id, event_at desc);
