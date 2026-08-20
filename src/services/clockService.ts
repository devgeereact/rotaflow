import { supabase } from '@/lib/supabase';
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

export interface ClockEventRange {
  staffProfileId: string;
  /** Inclusive ISO instant. */
  fromIso: string;
  /** Exclusive ISO instant. */
  toIso: string;
}

/** One person's events in a window, oldest first. Pairs into in/out shifts for hours totals. */
export async function listClockEventsForStaff(
  range: ClockEventRange,
): Promise<ClockEvent[]> {
  const { data, error } = await supabase
    .from('clock_events')
    .select('*')
    .eq('staff_profile_id', range.staffProfileId)
    .gte('event_at', range.fromIso)
    .lt('event_at', range.toIso)
    .order('event_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export interface OrgClockEventRange {
  orgId: string;
  fromIso: string;
  toIso: string;
}

/** Every event across the org in a window, newest first. Manager review. */
export async function listClockEventsForOrg(
  range: OrgClockEventRange,
): Promise<ClockEvent[]> {
  const { data, error } = await supabase
    .from('clock_events')
    .select('*')
    .eq('org_id', range.orgId)
    .gte('event_at', range.fromIso)
    .lt('event_at', range.toIso)
    .order('event_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
