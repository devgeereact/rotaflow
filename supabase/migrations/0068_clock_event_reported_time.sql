-- =====================================================================
-- 0068_clock_event_reported_time.sql — stop silently rewriting the time
-- someone clocked in (docs/SAAS.md BUG-045)
--
-- `clock_events_guard_event_at` (0037) replaces `event_at` with `now()`
-- when a non-manager submits a time that is null, more than 5 minutes in
-- the future, or more than 72 hours old. It does it silently: no error, no
-- record, and the outbox counts the write as synced.
--
-- The guard itself is right and stays. Without it a staff member could
-- backdate a clock-in to any shift they liked, and that is a payroll fraud
-- control, not a nicety.
--
-- What is wrong is that the correction leaves no trace. The case it hits
-- in practice is not fraud at all: a carer whose phone had no signal for
-- three days replays a genuine clock-in from the offline outbox, and it
-- lands stamped with the moment it synced rather than the moment they
-- started work. Their timesheet is then wrong, nobody can see that it was
-- changed, and the only person who could correct it does not know there is
-- anything to correct.
--
-- WHY NOT JUST REJECT IT
--
-- Raising instead of clamping was the other option, and it is worse. The
-- clock-in really happened. Refusing it dead-letters the write and tells a
-- carer "this did not save, do it again" for a shift they have already
-- worked — losing the record entirely rather than merely mis-timing it.
-- Between a wrong time that can be corrected and no row at all, the row
-- wins, provided the discrepancy is visible.
--
-- So: keep the row, keep the guard, and keep BOTH times. `event_at` stays
-- clamped, so every downstream hours calculation stays bounded exactly as
-- before. `event_at_reported` records what the device actually claimed,
-- and is null whenever the guard did not intervene — so "null" means "this
-- is exactly what the device said", which is the common case and costs
-- nothing to store.
--
-- A manager can then amend the event through the path that already exists
-- (`updateClockEvent`, 0037's manager-only UPDATE policy), which is the
-- correct place for that judgement: only a human knows whether the carer
-- really started at 07:00 on Tuesday.
--
-- MIGRATION RISK. One nullable column with no default — no table rewrite,
-- no backfill, no change to any existing row — plus a `create or replace`
-- of one trigger function. It is reversible by re-applying 0037's version
-- of that function and dropping the column. The database still has no
-- backups (GAP-001), which is exactly why this stops at the smallest
-- change that fixes the dishonesty.
-- =====================================================================

alter table public.clock_events
  add column if not exists event_at_reported timestamptz;

comment on column public.clock_events.event_at_reported is
  'What the device claimed, when clock_events_guard_event_at overrode it. NULL means event_at is exactly what was submitted — the normal case. Set only by that trigger; a manager amending an event should correct event_at itself.';

-- Only rows the guard touched, which is the only time this column is read.
create index if not exists clock_events_reported_idx
  on public.clock_events (org_id, event_at_reported)
  where event_at_reported is not null;

create or replace function public.clock_events_guard_event_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Owners and managers are exempt, as before: amending someone's clock
  -- event is their job, and 0037's UPDATE policy is what gates it.
  if not public.has_org_role(new.org_id, array['owner','manager']) then
    if new.event_at is null
       or new.event_at > timezone('utc', now()) + interval '5 minutes'
       or new.event_at < timezone('utc', now()) - interval '72 hours' then

      -- The whole point of 0068. Record what was submitted before replacing
      -- it, so the override is visible to the manager who can act on it.
      --
      -- A null submission is left null here rather than stored: there is no
      -- claimed time to preserve, and writing now() into both columns would
      -- assert the device said something it did not.
      new.event_at_reported := new.event_at;
      new.event_at := timezone('utc', now());
    else
      -- Not overridden. Null keeps the column's meaning exact, and stops a
      -- client from fabricating a "reported" time by supplying one.
      new.event_at_reported := null;
    end if;
  end if;
  return new;
end;
$$;

-- Unchanged from 0037, restated because `create or replace` above resets
-- nothing about privileges and this function needs no RPC surface.
revoke all on function public.clock_events_guard_event_at() from public, anon, authenticated;
