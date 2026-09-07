import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/pagination';
import { BOUNDARY_CONTEXT_HOURS, shiftIso } from '@/lib/hours';
import { touchOrgActivity } from '@/services/activityService';
import type { ClockEvent, ClockEventCorrection, ClockEventInsert } from '@/types';

/**
 * The insert path predates its screen (Phase 4). UseSyncQueue needed
 * something real to replay a queued 'clock' item against. This phase adds the
 * reads a clock in/out screen and an hours view actually need.
 */
export async function recordClockEvent(input: ClockEventInsert): Promise<ClockEvent> {
  const { data, error } = await supabase
    .from('clock_events')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  // A clock-in is the clearest evidence a human is using this tenant today.
  touchOrgActivity(data.org_id);
  return data;
}

/**
 * The most recent event for one person, to derive their current status
 * (clocked in / on break / clocked out) without maintaining a separate
 * "current state" column that could drift from the event log.
 */
export async function getLatestClockEvent(
  staffProfileId: string,
): Promise<ClockEvent | null> {
  const { data, error } = await supabase
    .from('clock_events')
    .select('*')
    .eq('staff_profile_id', staffProfileId)
    .order('event_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Correct an existing event's recorded time or type.
 *
 * Goes through `correct_clock_event` (`0128`), which is now the only writer:
 * the direct UPDATE grant on `clock_events` was withdrawn in the same
 * migration, so this cannot be routed around.
 *
 * That function does four things a PATCH could not. It demands a reason. It
 * records the row either side, the actor and the moment in
 * `clock_event_corrections`, which no client may write to or edit. It refuses
 * a write whose `expectedUpdatedAt` no longer matches, so two managers
 * correcting the same row do not silently overwrite each other. And where the
 * correction lands inside an already-approved period it flags that timesheet
 * for a fresh decision instead of moving a total somebody has signed.
 *
 * The previous implementation wrote over the row directly and its own comment
 * admitted the consequence: "`updated_at` is the only trace that a correction
 * happened". These events become somebody's pay.
 */
export interface ClockCorrection {
  /** Why. Three characters minimum, enforced in the database as well. */
  reason: string;
  /** New instant, ISO. Omit to leave the time alone. */
  eventAt?: string;
  /** New type. Omit to leave it alone. */
  type?: ClockEvent['type'];
  /**
   * The `updated_at` the caller read.
   *
   * Always send it. Omitting it opts out of the concurrency check, which is
   * only ever right for a server-side backfill — from a screen it means the
   * last person to press Save wins and the other correction disappears.
   */
  expectedUpdatedAt?: string;
}

export async function correctClockEvent(
  id: string,
  correction: ClockCorrection,
): Promise<ClockEvent> {
  const { data, error } = await supabase.rpc('correct_clock_event', {
    p_event: id,
    p_reason: correction.reason,
    p_event_at: correction.eventAt ?? null,
    p_type: correction.type ?? null,
    p_expected_updated_at: correction.expectedUpdatedAt ?? null,
  });
  if (error) throw error;
  return data;
}

/** The correction history for one event, newest first. Owner and manager only (0128). */
export async function listClockEventCorrections(
  clockEventId: string,
): Promise<ClockEventCorrection[]> {
  const { data, error } = await supabase
    .from('clock_event_corrections')
    .select('*')
    .eq('clock_event_id', clockEventId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Whether to read the events either side of the window as well.
 *
 * RF-08. A stream bounded exactly by the reporting window cannot be paired
 * correctly at its edges: the `out` of a night shift is inside the window and
 * its `in` is not, so `pairClockEvents` drops it; and the window that held
 * that `in` had no `out`, so the segment was closed against `now` and paid to
 * the moment the report was run.
 *
 * Callers that want *the events in this window* — a live dashboard count, the
 * schedule strip — leave this off and get exactly that. Callers computing
 * hours turn it on and then keep the segments the period owns, with
 * `segmentsStartingWithin`.
 */
export interface BoundaryContext {
  withBoundaryContext?: boolean;
}

export interface ClockEventRange extends BoundaryContext {
  staffProfileId: string;
  /** Inclusive ISO instant. */
  fromIso: string;
  /** Exclusive ISO instant. */
  toIso: string;
}

/** The instants to actually query, widened when boundary context was asked for. */
function windowFor(range: {
  fromIso: string;
  toIso: string;
  withBoundaryContext?: boolean;
}): [string, string] {
  if (!range.withBoundaryContext) return [range.fromIso, range.toIso];
  return [
    shiftIso(range.fromIso, -BOUNDARY_CONTEXT_HOURS),
    shiftIso(range.toIso, BOUNDARY_CONTEXT_HOURS),
  ];
}

/** One person's events in a window, oldest first. Pairs into in/out shifts for hours totals. */
export async function listClockEventsForStaff(
  range: ClockEventRange,
): Promise<ClockEvent[]> {
  const [fromIso, toIso] = windowFor(range);
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('clock_events')
      .select('*')
      .eq('staff_profile_id', range.staffProfileId)
      .gte('event_at', fromIso)
      .lt('event_at', toIso)
      .order('event_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return data ?? [];
  });
}

export interface OrgClockEventRange extends BoundaryContext {
  orgId: string;
  fromIso: string;
  toIso: string;
}

/** Every event across the org in a window, newest first. Manager review. */
export async function listClockEventsForOrg(
  range: OrgClockEventRange,
): Promise<ClockEvent[]> {
  const [fromIso, toIso] = windowFor(range);
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('clock_events')
      .select('*')
      .eq('org_id', range.orgId)
      .gte('event_at', fromIso)
      .lt('event_at', toIso)
      // Ascending, then reversed below. Paging a descending order is the same
      // work; ordering by the same key in both places is what keeps the pages
      // from overlapping, and `id` is the tie-breaker that makes it total.
      .order('event_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return data ?? [];
  }).then((rows) => rows.reverse());
}
