/**
 * View model for the clock-in screen (design/clockin.png).
 *
 * The `src/components/clockin/*` cards are presentational — they render
 * pre-formatted strings and never touch a Date, a timezone or a Supabase row.
 * Everything real is computed here from `shifts` + `clock_events` and mapped
 * into these shapes, so `/app/clock` and `/clockin-preview` feed the same
 * components with the same props.
 *
 * Lives in `lib`, not `services`, deliberately: it is pure and covered by
 * `clockRows.test.ts`, and importing a service would drag `@/lib/supabase` —
 * and a WebSocket Node 20 does not have — into the test run.
 */
import { addMinutes, differenceInMinutes, format, isSameDay, subDays } from 'date-fns';
import { pairClockEvents, totalWorkedMinutes } from '@/lib/hours';
import type { WorkedSegment } from '@/lib/hours';
import type { ClockEvent, Shift } from '@/types';

/**
 * How early a shift's clock-in window opens, in minutes. The reference's
 * policy banner states this rule ("within 15 minutes of your scheduled start
 * time"), so the banner copy and the "Within time window" ring caption are
 * both generated from this one constant rather than drifting apart.
 */
export const CLOCK_IN_WINDOW_MINUTES = 15;

/** How many events the Recent Activity rail card shows (the reference shows 3). */
export const RECENT_ACTIVITY_LIMIT = 3;

/** Where the person is in the shift, which drives every action on the screen. */
export type ClockStage = 'ready' | 'working' | 'break' | 'done';

export interface CurrentShiftInfo {
  /** "Starts in 12 min" — the pill above the time. */
  countdownLabel: string;
  timeRange: string;
  dateLabel: string;
  locationName: string;
  /** Department. `null` where the shift has none — the row is dropped. */
  areaName: string | null;
  /** The person's job title. `null` where the profile has none. */
  roleName: string | null;
  /** `null` where the shift has no shift_type — the field is dropped. */
  shiftTypeName: string | null;
  /** "12:30 – 13:00", or `null` for a shift with no unpaid break. */
  breakRange: string | null;
  /** Rendered muted next to the break range, e.g. "(30 min)". */
  breakDuration: string | null;
  paidHours: string;
  /** The reference's amber footer note. `null` hides it. */
  reminder: { title: string; body: string } | null;
}

export type ScheduleEntryTone = 'upcoming' | 'active' | 'break' | 'done';

export interface TodayScheduleEntry {
  id: string;
  timeRange: string;
  title: string;
  /** Only the shift rows carry a location in the reference; breaks do not. */
  locationName?: string;
  badgeLabel: string;
  tone: ScheduleEntryTone;
}

export interface ClockActivityEntry {
  id: string;
  /** 'in' renders the green icon, 'out' the red one (design/clockin.png). */
  kind: 'in' | 'out' | 'break';
  label: string;
  timeLabel: string;
  locationName: string;
  /** Shown right-aligned on clock-outs only — the shift length worked. */
  durationLabel?: string;
}

export interface WeeklySummaryStat {
  label: string;
  value: string;
  /** The variance figure is the only one the reference tints green. */
  positive?: boolean;
}

export interface WeeklySummaryData {
  stats: WeeklySummaryStat[];
  /** 0-100, drives the progress bar width. */
  completedPercent: number;
  progressLabel: string;
  /** `null` where nothing was scheduled — a percentage would be a lie. */
  attendancePercent: number | null;
}

export type AttendanceTone = 'good' | 'warning' | 'bad';

export interface AttendanceSummary {
  tone: AttendanceTone;
  statusTitle: string;
  statusBody: string;
  thisWeekValue: string;
  lastWeekValue: string;
}

/** Name lookups resolved by the page from the org's reference tables. */
export interface ClockLookups {
  locationNames: Record<string, string>;
  departmentNames: Record<string, string>;
  shiftTypeNames: Record<string, string>;
  jobTitle: string | null;
}

/** "35h 02m" — the reference zero-pads minutes but never the hour. */
export function formatHm(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
}

/** "+2h 28m" / "-1h 05m" — the variance figure, which carries its sign. */
export function formatSignedHm(minutes: number): string {
  const rounded = Math.round(minutes);
  return `${rounded < 0 ? '-' : '+'}${formatHm(Math.abs(rounded))}`;
}

/**
 * Paid minutes for one shift: its length less its unpaid break.
 *
 * On bad data `break_minutes` could exceed the shift length; clamped at zero so
 * one broken row cannot subtract from the rest of the week's total.
 */
export function scheduledMinutes(shift: Shift): number {
  const gross = differenceInMinutes(new Date(shift.ends_at), new Date(shift.starts_at));
  return Math.max(0, gross - shift.break_minutes);
}

/**
 * Where the person is in their shift, from their most recent event.
 *
 * `break_end` is 'working', not a state of its own — ending a break puts you
 * back on shift, and the next thing you do is clock out.
 */
export function clockStage(latest: ClockEvent | null): ClockStage {
  switch (latest?.type) {
    case 'in':
    case 'break_end':
      return 'working';
    case 'break_start':
      return 'break';
    case 'out':
      return 'done';
    default:
      return 'ready';
  }
}

/**
 * The shift the screen is about: the one in progress, else the next one still
 * to start, else the last one that ran. Assumes `shifts` is same-day and
 * already scoped to this person.
 */
export function pickCurrentShift(shifts: Shift[], now: Date): Shift | null {
  const byStart = [...shifts].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  );
  return (
    byStart.find(
      (s) => new Date(s.starts_at) <= now && now < new Date(s.ends_at),
    ) ??
    byStart.find((s) => now < new Date(s.starts_at)) ??
    byStart[byStart.length - 1] ??
    null
  );
}

/**
 * When the unpaid break falls.
 *
 * The schema stores `break_minutes` — a duration — and no break start time, so
 * there is nothing to read. Centred on the shift's midpoint, which is where a
 * mid-shift break lands in practice; it is a display convenience only, and
 * nothing pays or bills off it. Noted as inferred in design/.loop/clockin-log.md.
 */
export function breakWindow(shift: Shift): { start: Date; end: Date } | null {
  const minutes = shift.break_minutes;
  if (minutes <= 0) return null;
  const starts = new Date(shift.starts_at).getTime();
  const ends = new Date(shift.ends_at).getTime();
  if (ends <= starts) return null;
  const start = addMinutes(new Date((starts + ends) / 2), -minutes / 2);
  return { start, end: addMinutes(start, minutes) };
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "Starts in 12 min" / "Ends in 3h 20m" / "Ended" — the pill above the time. */
export function shiftCountdownLabel(shift: Shift, now: Date): string {
  const start = new Date(shift.starts_at);
  const end = new Date(shift.ends_at);
  if (now < start) return `Starts in ${durationLabel(differenceInMinutes(start, now))}`;
  if (now < end) return `Ends in ${durationLabel(differenceInMinutes(end, now))}`;
  return 'Ended';
}

export interface ClockWindow {
  label: string;
  /** Whether clocking in now is inside the policy window. */
  within: boolean;
}

/**
 * The caption under the live clock. Open from
 * `CLOCK_IN_WINDOW_MINUTES` before the start until the shift ends — late
 * clock-ins are flagged, never blocked, because a blocked clock-in is an unpaid
 * hour.
 */
export function clockWindow(shift: Shift | null, now: Date): ClockWindow {
  if (!shift) return { label: 'No shift scheduled', within: false };
  const start = new Date(shift.starts_at);
  const opensAt = addMinutes(start, -CLOCK_IN_WINDOW_MINUTES);
  if (now < opensAt) return { label: `Opens at ${format(opensAt, 'HH:mm')}`, within: false };
  if (now >= new Date(shift.ends_at)) return { label: 'Shift has ended', within: false };
  return { label: 'Within time window', within: true };
}

function timeRange(from: Date, to: Date): string {
  return `${format(from, 'HH:mm')} – ${format(to, 'HH:mm')}`;
}

/** `shifts.location_id` is nullable, and an unknown id must never be printed. */
function locationName(shift: Shift, lookups: ClockLookups): string | null {
  if (!shift.location_id) return null;
  return lookups.locationNames[shift.location_id] ?? null;
}

export function buildCurrentShift(
  shift: Shift,
  lookups: ClockLookups,
  now: Date,
): CurrentShiftInfo {
  const start = new Date(shift.starts_at);
  const end = new Date(shift.ends_at);
  const brk = breakWindow(shift);
  const departmentName = shift.department_id
    ? (lookups.departmentNames[shift.department_id] ?? null)
    : null;
  const shiftTypeName = shift.shift_type_id
    ? (lookups.shiftTypeNames[shift.shift_type_id] ?? null)
    : null;

  return {
    countdownLabel: shiftCountdownLabel(shift, now),
    timeRange: timeRange(start, end),
    dateLabel: isSameDay(start, now)
      ? `Today, ${format(start, 'd MMM yyyy')}`
      : format(start, 'EEEE, d MMM yyyy'),
    locationName: locationName(shift, lookups) ?? 'Unassigned location',
    areaName: departmentName,
    roleName: lookups.jobTitle,
    shiftTypeName,
    breakRange: brk ? timeRange(brk.start, brk.end) : null,
    breakDuration: brk ? `(${shift.break_minutes} min)` : null,
    paidHours: formatHm(scheduledMinutes(shift)),
    reminder: brk
      ? {
          title: 'Reminder',
          body: 'Please ensure you take your required breaks.',
        }
      : null,
  };
}

function shiftTone(shift: Shift, now: Date): ScheduleEntryTone {
  if (now >= new Date(shift.ends_at)) return 'done';
  if (now >= new Date(shift.starts_at)) return 'active';
  return 'upcoming';
}

const SHIFT_TONE_LABEL: Record<ScheduleEntryTone, string> = {
  upcoming: 'Upcoming',
  active: 'In progress',
  break: 'Break',
  done: 'Completed',
};

/** The day's shifts, each followed by its unpaid break as its own row. */
export function buildTodaySchedule(
  shifts: Shift[],
  lookups: ClockLookups,
  now: Date,
): TodayScheduleEntry[] {
  return [...shifts]
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    .flatMap((shift): TodayScheduleEntry[] => {
      const tone = shiftTone(shift, now);
      const rows: TodayScheduleEntry[] = [
        {
          id: shift.id,
          timeRange: timeRange(new Date(shift.starts_at), new Date(shift.ends_at)),
          title:
            lookups.jobTitle ??
            (shift.shift_type_id ? lookups.shiftTypeNames[shift.shift_type_id] : null) ??
            'Scheduled shift',
          locationName: locationName(shift, lookups) ?? undefined,
          badgeLabel: SHIFT_TONE_LABEL[tone],
          tone,
        },
      ];
      const brk = breakWindow(shift);
      if (brk) {
        rows.push({
          id: `${shift.id}-break`,
          timeRange: timeRange(brk.start, brk.end),
          title: 'Unpaid Break',
          badgeLabel: SHIFT_TONE_LABEL.break,
          tone: 'break',
        });
      }
      return rows;
    });
}

const ACTIVITY_LABEL: Record<string, string> = {
  in: 'Clock In',
  out: 'Clock Out',
  break_start: 'Break Started',
  break_end: 'Break Ended',
};

function activityKind(type: string): ClockActivityEntry['kind'] {
  if (type === 'in') return 'in';
  if (type === 'out') return 'out';
  return 'break';
}

/**
 * "Today, 09:00" / "Yesterday, 17:02" / "Tue, 12 May, 17:01".
 *
 * Both comparisons are against the caller's `now`, not date-fns's `isToday` /
 * `isYesterday`, which read the system clock: those would label an event
 * relative to the real date rather than the date the screen is rendering, and
 * silently disagree with the countdown and window captions beside them.
 */
export function activityTimeLabel(at: Date, now: Date): string {
  const time = format(at, 'HH:mm');
  if (isSameDay(at, now)) return `Today, ${time}`;
  if (isSameDay(at, subDays(now, 1))) return `Yesterday, ${time}`;
  return `${format(at, 'EEE, d MMM')}, ${time}`;
}

/**
 * The most recent events, newest first.
 *
 * Clock-outs carry the length of the segment they closed, which is why the
 * whole event list is paired rather than each event read in isolation.
 */
export function buildRecentActivity(
  events: ClockEvent[],
  now: Date,
  limit: number = RECENT_ACTIVITY_LIMIT,
): ClockActivityEntry[] {
  const workedByClockOutId = new Map<string, number>();
  for (const segment of pairClockEvents(events, now)) {
    if (segment.clockOut) workedByClockOutId.set(segment.clockOut.id, segment.minutes);
  }

  return [...events]
    .sort((a, b) => new Date(b.event_at).getTime() - new Date(a.event_at).getTime())
    .slice(0, limit)
    .map((event): ClockActivityEntry => {
      const worked = workedByClockOutId.get(event.id);
      return {
        id: event.id,
        kind: activityKind(event.type),
        label: ACTIVITY_LABEL[event.type] ?? 'Clock event',
        timeLabel: activityTimeLabel(new Date(event.event_at), now),
        locationName: event.location_name ?? 'Location not recorded',
        ...(worked === undefined ? {} : { durationLabel: formatHm(worked) }),
      };
    });
}

/**
 * The segments belonging to a week, keyed on where each one *started*.
 *
 * Callers pair the whole multi-week window once and then bucket, rather than
 * slicing the events per week and pairing each slice: a night shift clocking in
 * 23:00 Sunday and out 07:00 Monday would otherwise land its `in` in one slice
 * and its `out` in the next, and the first slice would see an unclosed segment
 * and run it to `now` — inventing hours nobody worked.
 */
export function segmentsInRange(
  segments: WorkedSegment[],
  from: Date,
  to: Date,
): WorkedSegment[] {
  return segments.filter((segment) => {
    const at = new Date(segment.clockIn.event_at);
    return at >= from && at < to;
  });
}

/**
 * Scheduled vs worked for one week.
 *
 * `attendancePercent` is `null` rather than 0 when nothing was scheduled —
 * "0% attendance" for a week someone was not rostered is a false accusation,
 * and the card shows "—" instead.
 */
export function buildWeeklySummary(
  shifts: Shift[],
  segments: WorkedSegment[],
): WeeklySummaryData {
  const scheduled = shifts.reduce((sum, shift) => sum + scheduledMinutes(shift), 0);
  const worked = totalWorkedMinutes(segments);
  const breaks = segments.reduce((sum, segment) => sum + segment.breakMinutes, 0);
  const variance = worked - scheduled;
  const percent = scheduled > 0 ? (worked / scheduled) * 100 : null;

  return {
    stats: [
      { label: 'Scheduled Hours', value: formatHm(scheduled) },
      { label: 'Worked Hours', value: formatHm(worked) },
      { label: 'Break Hours', value: formatHm(breaks) },
      { label: 'Variance', value: formatSignedHm(variance), positive: variance >= 0 },
    ],
    completedPercent: percent === null ? 0 : Math.min(100, Math.round(percent)),
    progressLabel:
      percent === null
        ? 'No hours scheduled this week'
        : `${Math.round(percent)}% of scheduled hours completed`,
    attendancePercent: percent,
  };
}

function percentLabel(percent: number | null): string {
  return percent === null ? '—' : `${Math.round(percent)}%`;
}

/** The reassurance panel — thresholds are a product judgement, not schema. */
export function buildAttendance(
  thisWeek: number | null,
  lastWeek: number | null,
): AttendanceSummary {
  const tone: AttendanceTone =
    thisWeek === null || thisWeek >= 95 ? 'good' : thisWeek >= 80 ? 'warning' : 'bad';

  const copy: Record<AttendanceTone, { title: string; body: string }> = {
    good: {
      title: 'On Track',
      body:
        thisWeek === null
          ? 'Nothing scheduled this week.'
          : "Great job! You're on track this week.",
    },
    warning: {
      title: 'Slightly Behind',
      body: 'You are a little under your scheduled hours this week.',
    },
    bad: {
      title: 'Needs Attention',
      body: 'Your worked hours are well below what was scheduled.',
    },
  };

  return {
    tone,
    statusTitle: copy[tone].title,
    statusBody: copy[tone].body,
    thisWeekValue: percentLabel(thisWeek),
    lastWeekValue: percentLabel(lastWeek),
  };
}
