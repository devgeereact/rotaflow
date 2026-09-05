import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/pagination';
import { BOUNDARY_CONTEXT_HOURS, shiftIso } from '@/lib/hours';
import { touchOrgActivity } from '@/services/activityService';
import type { ClockEvent, ClockEventInsert, ClockEventUpdate } from '@/types';

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
 * Correct an existing event's recorded time. RLS (`clock_events_update`,
 * 0037) restricts this to an owner or manager of the event's org — a staff
 * member's own `clock_events_insert` grant does not extend to `update`, so
 * this is never reachable from anyone editing their own clock-in.
 *
 * Writes over the row directly rather than inserting a correction record:
 * there is no separate history/audit column on `clock_events` for that, so
 * `updated_at` (bumped automatically by the table's own trigger) is the only
 * trace that a correction happened.
 */
export async function updateClockEvent(
  id: string,
  patch: ClockEventUpdate,
): Promise<ClockEvent> {
  const { data, error } = await supabase
    .from('clock_events')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
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
