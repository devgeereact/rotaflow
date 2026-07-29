import type { ClockEvent } from '@/types';

export interface WorkedSegment {
  clockIn: ClockEvent;
  clockOut: ClockEvent | null;
  breakMinutes: number;
  /** Minutes worked, excluding breaks. Ongoing (no clockOut yet) uses `now`. */
  minutes: number;
}

/**
 * Pairs a chronological event stream into worked segments (in → out, minus
 * any break in between). There is no `timesheets` automation in the schema
 * (docs/SCHEMA.md — it's a manually-managed aggregate, not trigger-populated),
 * so this is computed client-side directly from `clock_events` rather than
 * reading a maintained total.
 *
 * Tolerant of a missing `out` (still clocked in) and of an `out` with no
 * matching `in` (a queued offline event replayed out of order, or a manually
 * corrected row) — neither should throw away the rest of the data.
 */
export function pairClockEvents(
  events: ClockEvent[],
  now: Date = new Date(),
): WorkedSegment[] {
  const sorted = [...events].sort(
    (a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime(),
  );

  const segments: WorkedSegment[] = [];
  let openIn: ClockEvent | null = null;
  let breakStart: ClockEvent | null = null;
  let breakMinutes = 0;

  for (const event of sorted) {
    if (event.type === 'in') {
      openIn = event;
      breakMinutes = 0;
    } else if (event.type === 'break_start' && openIn) {
      breakStart = event;
    } else if (event.type === 'break_end' && openIn && breakStart) {
      breakMinutes +=
        (new Date(event.event_at).getTime() - new Date(breakStart.event_at).getTime()) /
        60_000;
      breakStart = null;
    } else if (event.type === 'out' && openIn) {
      const grossMinutes =
        (new Date(event.event_at).getTime() - new Date(openIn.event_at).getTime()) /
        60_000;
      segments.push({
        clockIn: openIn,
        clockOut: event,
        breakMinutes,
        minutes: Math.max(0, grossMinutes - breakMinutes),
      });
      openIn = null;
      breakStart = null;
      breakMinutes = 0;
    }
  }

  // Still clocked in — an ongoing segment up to `now`, not dropped.
  if (openIn) {
    const grossMinutes = (now.getTime() - new Date(openIn.event_at).getTime()) / 60_000;
    segments.push({
      clockIn: openIn,
      clockOut: null,
      breakMinutes,
      minutes: Math.max(0, grossMinutes - breakMinutes),
    });
  }

  return segments;
}

export function totalWorkedMinutes(segments: WorkedSegment[]): number {
  return segments.reduce((sum, s) => sum + s.minutes, 0);
}

export function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}
