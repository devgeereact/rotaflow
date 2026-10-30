import { activeOrgPath, api, orgPath, seg } from '@/lib/api';
import { BOUNDARY_CONTEXT_HOURS, shiftIso } from '@/lib/hours';
import type { ClockEvent, ClockEventCorrection, ClockEventInsert } from '@/types';

/**
 * The insert path predates its screen (Phase 4). UseSyncQueue needed
 * something real to replay a queued 'clock' item against. This phase adds the
 * reads a clock in/out screen and an hours view actually need.
 */
type ApiClockEvent = ClockEvent;

const n = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);

function toEvent(e: ApiClockEvent): ClockEvent {
  return {
    ...e,
    latitude: n(e.latitude),
    longitude: n(e.longitude),
    accuracy: n(e.accuracy),
  };
}

const PAGE = 1000;

/** Newest first, a page at a time (the API answers at most 1000 a read), until the window is exhausted. */
async function readWindow(
  path: string,
  query: Record<string, string | undefined>,
  fromIso: string,
  toIso: string,
): Promise<ClockEvent[]> {
  const out: ClockEvent[] = [];
  let upper = toIso;
  for (;;) {
    const r = await api.get<{ clock_events: ApiClockEvent[] }>(path, {
      ...query,
      from: fromIso,
      to: upper,
      limit: PAGE,
    });
    out.push(...r.clock_events.map(toEvent));
    const last = r.clock_events[r.clock_events.length - 1];
    if (r.clock_events.length < PAGE || !last) break;
    upper = last.event_at;
  }
  const seen = new Set<string>();
  return out.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

export async function recordClockEvent(input: ClockEventInsert): Promise<ClockEvent> {
  // A replay of the same `client_event_id` answers 200 with the stored event (`already_applied`), so the offline
  // outbox can send it again safely.
  const r = await api.post<{ clock_event: ApiClockEvent; already_applied: boolean }>(
    orgPath(input.org_id, '/clock-events'),
    {
      staff_profile_id: input.staff_profile_id,
      shift_id: input.shift_id ?? null,
      type: input.type,
      event_at: input.event_at ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      accuracy: input.accuracy ?? null,
      method: input.method ?? 'manual',
      location_name: input.location_name ?? null,
      client_event_id: input.client_event_id ?? null,
    },
  );
  return toEvent(r.clock_event);
}

/**
 * The most recent event for one person, to derive their current status
 * (clocked in / on break / clocked out) without maintaining a separate
 * "current state" column that could drift from the event log.
 */
export async function getLatestClockEvent(
  staffProfileId: string,
): Promise<ClockEvent | null> {
  const r = await api.get<{ clock_events: ApiClockEvent[] }>(
    activeOrgPath('/clock-events'),
    {
      staff_profile_id: staffProfileId,
      latest: '1',
    },
  );
  const e = r.clock_events[0];
  return e ? toEvent(e) : null;
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
  const r = await api.post<{ clock_event: ApiClockEvent }>(
    activeOrgPath(`/clock-events/${seg(id)}/correct`),
    {
      reason: correction.reason,
      event_at: correction.eventAt ?? null,
      type: correction.type ?? null,
      expected_updated_at: correction.expectedUpdatedAt ?? null,
    },
  );
  return toEvent(r.clock_event);
}

/** The correction history for one event, newest first. Owner and manager only (0128). */
export async function listClockEventCorrections(
  clockEventId: string,
): Promise<ClockEventCorrection[]> {
  const r = await api.get<{ corrections: ClockEventCorrection[] }>(
    activeOrgPath(`/clock-events/${seg(clockEventId)}/corrections`),
  );
  return r.corrections.map((c) => ({ ...c, clock_event_id: clockEventId }));
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
  const rows = await readWindow(
    activeOrgPath('/clock-events'),
    { staff_profile_id: range.staffProfileId },
    fromIso,
    toIso,
  );
  return rows.sort(
    (a, b) => a.event_at.localeCompare(b.event_at) || a.id.localeCompare(b.id),
  );
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
  // Newest first, as the attendance screens read it.
  const rows = await readWindow(
    orgPath(range.orgId, '/clock-events'),
    {},
    fromIso,
    toIso,
  );
  return rows.sort(
    (a, b) => b.event_at.localeCompare(a.event_at) || b.id.localeCompare(a.id),
  );
}
