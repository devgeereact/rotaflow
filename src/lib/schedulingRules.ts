/**
 * Scheduling warnings and recurring patterns (R2 slice S11). Pure functions only.
 *
 * Ported from SiteRelay `backend/src/Mod/Scheduling.php` (warnings, rest, patterns) and
 * `src/features/scheduling/rota-tools.ts` (form checks, headlines), re-made for RotaFlow's
 * rows: a shift belongs to a staff record, availability uses 0 = Sunday weekdays, leave is
 * `leave_requests` with inclusive local dates.
 *
 * The server is the authority: `backend/src/SchedulingRules.php` holds the same rules and the
 * publish preview is computed there. This copy lets the assign dialog warn as the manager types,
 * without a round trip per keystroke. The two are kept in step by mirrored test cases
 * (`schedulingRules.test.ts` and `backend/tests/suites/240-scheduling.php`).
 *
 * Warnings never block. An overlap (the same person in two places at once) is not a warning: the
 * builder already refuses it on every write path, and the publish preview reports it as blocking.
 */
import {
  addDays,
  daysBetween,
  isoWeekday,
  utcToZoned,
  zonedToUtc,
} from '@/lib/zonedTime';

export type WarningCode = 'leave' | 'unavailable' | 'rest' | 'weekly_hours';

export interface SchedulingWarning {
  code: WarningCode;
  message: string;
}

/** The fields of a shift the rules read. `timezone` is the shift's site zone, when it has one. */
export interface WarnShift {
  id: string;
  staff_profile_id: string | null;
  starts_at: string;
  ends_at: string;
  break_minutes: number;
  status: string;
  timezone?: string | null;
}

export interface WarnLeave {
  staff_profile_id: string;
  start_date: string;
  end_date: string;
  status: string;
  type: string;
}

/** `weekday` is 0 = Sunday ... 6 = Saturday, as stored. Times are 'HH:MM' or 'HH:MM:SS'. */
export interface WarnAvailability {
  staff_profile_id: string;
  weekday: number | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string;
  recurring: boolean;
}

export interface SchedulingLimits {
  /** Hours of continuous rest wanted in the 24 hours before a shift starts. 0 turns the check off. */
  minRestHours: number;
  /** Hours a person may be scheduled in one Monday-to-Sunday week. */
  maxWeeklyHours: number;
}

/** Working Time Regulations 1998: 11 hours' daily rest, a 48-hour week. Settings → Policies can change both. */
export const DEFAULT_SCHEDULING_LIMITS: SchedulingLimits = {
  minRestHours: 11,
  maxWeeklyHours: 48,
};

export const WARNING_ORDER: readonly WarningCode[] = [
  'leave',
  'unavailable',
  'rest',
  'weekly_hours',
];

export const WARNING_LABELS: Record<WarningCode, string> = {
  leave: 'On approved leave',
  unavailable: 'Declared unavailable',
  rest: 'Short rest',
  weekly_hours: 'Over weekly hours',
};

const DAY = 86_400_000;
const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PLURAL_DAYS = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** 'Mon 2 Nov' for a YYYY-MM-DD date. */
export function dayLabel(date: string): string {
  const month = MONTHS[Number(date.slice(5, 7)) - 1] ?? '';
  return `${SHORT_DAYS[isoWeekday(date) - 1] ?? ''} ${Number(date.slice(8, 10))} ${month}`;
}

/** 'Mon 2 Nov' or 'Mon 2 Nov – Fri 6 Nov'. */
export function dateSpan(a: string, b: string): string {
  return a === b ? dayLabel(a) : `${dayLabel(a)} – ${dayLabel(b)}`;
}

/** Hours to one decimal, without a trailing '.0': 7.5h, 8h. */
export function formatHours(ms: number): string {
  const h = Math.round((ms / 3_600_000) * 10) / 10;
  return `${String(h)}h`;
}

const hhmm = (t: string): string => t.slice(0, 5);

/**
 * Daily rest. In the 24 hours before `start`, is there a continuous break of at least `minMs`?
 * Split shifts on one day are fine as long as the long rest falls in that window.
 * Returns the rest immediately before the shift (ms) when the rule is broken, else null.
 */
export function restShortfall(
  others: readonly { s: number; e: number }[],
  start: number,
  minMs: number,
): number | null {
  const w0 = start - DAY;
  const iv: [number, number][] = [];
  for (const x of others) {
    if (x.e > w0 && x.s < start) iv.push([Math.max(x.s, w0), Math.min(x.e, start)]);
  }
  if (iv.length === 0) return null;
  iv.sort((a, b) => a[0] - b[0]);
  let cursor = w0;
  let maxGap = 0;
  for (const [a, b] of iv) {
    maxGap = Math.max(maxGap, a - cursor);
    cursor = Math.max(cursor, b);
  }
  const last = start - cursor;
  maxGap = Math.max(maxGap, last);
  return maxGap < minMs ? Math.max(0, last) : null;
}

/** Monday (YYYY-MM-DD) of the local week the instant falls in. */
export function weekOf(iso: string, tz: string): string {
  const { date } = utcToZoned(iso, tz);
  return addDays(date, 1 - isoWeekday(date));
}

/** Approved leave covering any part of [s, e). Leave dates are inclusive local days in `tz`. */
export function leaveHit(
  leave: readonly WarnLeave[],
  staffId: string,
  s: number,
  e: number,
  tz: string,
): WarnLeave | null {
  for (const l of leave) {
    if (l.staff_profile_id !== staffId || l.status !== 'approved') continue;
    const from = Date.parse(zonedToUtc(l.start_date, '00:00', tz));
    const to = Date.parse(zonedToUtc(addDays(l.end_date, 1), '00:00', tz));
    if (from < e && to > s) return l;
  }
  return null;
}

/**
 * The first 'unavailable' entry overlapping [s, e), checking each local day the shift touches
 * (at most three). A one-off date matches that day; a recurring weekday matches that weekday. No
 * times means the whole day; an end at or before the start runs past midnight.
 */
export function unavailableHit(
  entries: readonly WarnAvailability[],
  staffId: string,
  s: number,
  e: number,
  tz: string,
): { entry: WarnAvailability; day: string } | null {
  const mine = entries.filter(
    (a) => a.staff_profile_id === staffId && a.status === 'unavailable',
  );
  if (mine.length === 0) return null;
  let day = utcToZoned(new Date(s).toISOString(), tz).date;
  const last = utcToZoned(new Date(e - 1).toISOString(), tz).date;
  for (let i = 0; i < 3 && daysBetween(day, last) >= 0; i += 1, day = addDays(day, 1)) {
    const dow = isoWeekday(day) % 7; // 0 = Sunday, as stored
    for (const a of mine) {
      const applies = a.date ? a.date === day : a.recurring && a.weekday === dow;
      if (!applies) continue;
      let ws: number;
      let we: number;
      if (!a.start_time || !a.end_time) {
        ws = Date.parse(zonedToUtc(day, '00:00', tz));
        we = Date.parse(zonedToUtc(addDays(day, 1), '00:00', tz));
      } else {
        const st = hhmm(a.start_time);
        const et = hhmm(a.end_time);
        ws = Date.parse(zonedToUtc(day, st, tz));
        we = Date.parse(zonedToUtc(et <= st ? addDays(day, 1) : day, et, tz));
      }
      if (ws < e && we > s) return { entry: a, day };
    }
  }
  return null;
}

function unavailableText(a: WarnAvailability, day: string): string {
  const times =
    a.start_time && a.end_time
      ? ` ${hhmm(a.start_time)}–${hhmm(a.end_time)}`
      : ' all day';
  if (a.date) return `Declared unavailable ${dayLabel(day)}${times}`;
  return `Declared unavailable ${PLURAL_DAYS[a.weekday ?? 0] ?? ''}${times}`;
}

function leaveText(l: WarnLeave): string {
  const kind = l.type.trim() === '' ? 'leave' : l.type.trim().toLowerCase();
  return `On approved ${kind} (${dateSpan(l.start_date, l.end_date)})`;
}

/**
 * Warnings for each of `targets`, measured against `context` (the person's other shifts the rota
 * should be read with). Cancelled and open shifts never warn and never count. Leave and declared
 * availability are read in the shift's own zone; weeks run Monday to Sunday in `orgTz`.
 */
export function shiftWarnings(
  targets: readonly WarnShift[],
  context: readonly WarnShift[],
  leave: readonly WarnLeave[],
  availability: readonly WarnAvailability[],
  limits: SchedulingLimits,
  orgTz: string,
): Record<string, SchedulingWarning[]> {
  const live = (x: WarnShift): boolean =>
    x.status !== 'cancelled' && x.staff_profile_id !== null;
  const byId = new Map<string, WarnShift>();
  for (const x of [...context, ...targets]) if (live(x)) byId.set(x.id, x);
  const byPerson = new Map<string, WarnShift[]>();
  for (const x of byId.values()) {
    const k = x.staff_profile_id ?? '';
    byPerson.set(k, [...(byPerson.get(k) ?? []), x]);
  }
  const out: Record<string, SchedulingWarning[]> = {};
  for (const t of targets) {
    if (!live(t)) continue;
    const staff = t.staff_profile_id ?? '';
    const tz = t.timezone ?? orgTz;
    const s = Date.parse(t.starts_at);
    const e = Date.parse(t.ends_at);
    const mine = byPerson.get(staff) ?? [];
    const w: SchedulingWarning[] = [];
    const l = leaveHit(leave, staff, s, e, tz);
    if (l) w.push({ code: 'leave', message: leaveText(l) });
    const u = unavailableHit(availability, staff, s, e, tz);
    if (u) w.push({ code: 'unavailable', message: unavailableText(u.entry, u.day) });
    if (limits.minRestHours > 0) {
      const others = mine
        .filter((x) => x.id !== t.id)
        .map((x) => ({ s: Date.parse(x.starts_at), e: Date.parse(x.ends_at) }));
      const gap = restShortfall(others, s, limits.minRestHours * 3_600_000);
      if (gap !== null) {
        w.push({
          code: 'rest',
          message: `Only ${formatHours(gap)} rest before this shift (minimum ${limits.minRestHours}h in any 24 hours)`,
        });
      }
    }
    const week = weekOf(t.starts_at, orgTz);
    let weekMs = 0;
    for (const x of mine) {
      if (weekOf(x.starts_at, orgTz) !== week) continue;
      weekMs += Math.max(
        0,
        Date.parse(x.ends_at) - Date.parse(x.starts_at) - x.break_minutes * 60_000,
      );
    }
    if (weekMs > limits.maxWeeklyHours * 3_600_000) {
      w.push({
        code: 'weekly_hours',
        message: `${formatHours(weekMs)} scheduled in the week of ${dayLabel(week)} (limit ${limits.maxWeeklyHours}h)`,
      });
    }
    if (w.length > 0) out[t.id] = w;
  }
  return out;
}

/** How many warnings of each kind, in a fixed order, kinds with none left out. */
export function summariseWarnings(
  rows: readonly { warnings: readonly { code: string }[] }[],
): { code: WarningCode; label: string; count: number }[] {
  const n = new Map<string, number>();
  for (const r of rows)
    for (const w of r.warnings) n.set(w.code, (n.get(w.code) ?? 0) + 1);
  return WARNING_ORDER.filter((c) => (n.get(c) ?? 0) > 0).map((c) => ({
    code: c,
    label: WARNING_LABELS[c],
    count: n.get(c) ?? 0,
  }));
}

// ---- recurring patterns ------------------------------------------------------------------------

export const MAX_PATTERN_DAYS = 92;
export const MAX_PATTERN_SHIFTS = 500;
export const MAX_BLOCKS = 6;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const minutesOf = (t: string): number =>
  Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export interface TimeBlock {
  start: string;
  end: string;
}

/** Scheduled length in minutes for local HH:MM times, wrapping past midnight. 0 when equal or invalid. */
export function lengthMinutes(start: string, end: string): number {
  if (!TIME.test(start) || !TIME.test(end)) return 0;
  const d = minutesOf(end) - minutesOf(start);
  return d < 0 ? d + 1440 : d;
}

/** True when the finish is earlier than the start, so the shift ends the next day. */
export function isOvernight(start: string, end: string): boolean {
  return TIME.test(start) && TIME.test(end) && minutesOf(end) < minutesOf(start);
}

/** A whole number of minutes from 0 to 1440, or null. Empty means no break. */
export function parseBreak(raw: string): number | null {
  const v = raw.trim();
  if (v === '') return 0;
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n <= 1440 ? n : null;
}

export interface PatternRule {
  kind: 'weekly' | 'cycle';
  /** ISO weekdays, 1 = Monday ... 7 = Sunday (weekly). */
  weekdays?: number[];
  /** Days on, then days off, counted from `cycleStart` (cycle). */
  daysOn?: number;
  daysOff?: number;
  cycleStart?: string;
  from: string;
  to: string;
  blocks: TimeBlock[];
}

/** One shift a pattern makes, in local wall-clock terms. */
export interface PatternItem {
  date: string;
  start: string;
  endDate: string;
  end: string;
}

/** Every local shift a valid rule makes, in date then block order. No checks: see `patternError`. */
export function expandPattern(rule: PatternRule): PatternItem[] {
  const days = daysBetween(rule.from, rule.to) + 1;
  const weekly = new Set(rule.weekdays ?? []);
  const on = rule.daysOn ?? 0;
  const cycle = on + (rule.daysOff ?? 0);
  const anchor = rule.cycleStart ?? rule.from;
  const out: PatternItem[] = [];
  for (let i = 0; i < days; i += 1) {
    const date = addDays(rule.from, i);
    const works =
      rule.kind === 'weekly'
        ? weekly.has(isoWeekday(date))
        : cycle > 0 && daysBetween(anchor, date) % cycle < on;
    if (!works) continue;
    for (const b of rule.blocks) {
      out.push({
        date,
        start: b.start,
        endDate: b.end <= b.start ? addDays(date, 1) : date,
        end: b.end,
      });
    }
  }
  return out;
}

/** The form behind "Generate pattern". Text fields stay text until checked. */
export interface PatternFields {
  kind: 'weekly' | 'cycle';
  weekdays: number[];
  daysOn: string;
  daysOff: string;
  cycleStart: string;
  from: string;
  to: string;
  blocks: TimeBlock[];
  staffProfileId: string;
  locationId: string;
  shiftTypeId: string;
  breakRaw: string;
  notes: string;
}

const wholeIn = (raw: string, lo: number, hi: number): number | null => {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= lo && n <= hi ? n : null;
};

/**
 * The first thing the server would refuse, as a sentence, or '' when the form is good. `period`
 * is the rota's own dates: a pattern fills one draft rota and cannot spill outside it.
 */
export function patternError(
  f: PatternFields,
  period?: { start: string; end: string },
): string {
  if (!DATE.test(f.from) || !DATE.test(f.to)) return 'Choose the first and last date.';
  const days = daysBetween(f.from, f.to) + 1;
  if (days < 1) return 'The last date must be on or after the first date.';
  if (days > MAX_PATTERN_DAYS)
    return `A pattern can cover at most ${MAX_PATTERN_DAYS} days at a time.`;
  if (period && (f.from < period.start || f.to > period.end)) {
    return 'The dates must fall inside this rota’s period.';
  }
  if (f.kind === 'weekly') {
    if (f.weekdays.length === 0) return 'Choose at least one day of the week.';
  } else {
    if (wholeIn(f.daysOn, 1, 28) === null || wholeIn(f.daysOff, 1, 28) === null) {
      return 'Days on and days off must be whole numbers from 1 to 28.';
    }
    if (!DATE.test(f.cycleStart)) return 'Choose the day the cycle starts.';
    if (f.cycleStart > f.from) return 'The cycle must start on or before the first date.';
  }
  if (f.blocks.length < 1 || f.blocks.length > MAX_BLOCKS)
    return 'Give one to six time blocks.';
  for (const b of f.blocks) {
    if (!TIME.test(b.start) || !TIME.test(b.end) || b.start === b.end) {
      return 'Each time block needs a start and a different finish time.';
    }
  }
  const brk = parseBreak(f.breakRaw);
  if (brk === null) return 'Break must be a whole number of minutes.';
  if (f.blocks.some((b) => brk >= lengthMinutes(b.start, b.end))) {
    return 'The break must be shorter than each time block.';
  }
  if (f.notes.length > 1000) return 'Notes can be at most 1000 characters.';
  const n = expandPattern(patternRule(f)).length;
  if (n === 0) return 'That pattern has no working days in the chosen dates.';
  if (n > MAX_PATTERN_SHIFTS) {
    return `That pattern would make ${n} shifts; the limit is ${MAX_PATTERN_SHIFTS} at a time.`;
  }
  return '';
}

/** The rule a (checked) form describes. */
export function patternRule(f: PatternFields): PatternRule {
  const base = { from: f.from, to: f.to, blocks: f.blocks };
  if (f.kind === 'weekly') {
    return {
      kind: 'weekly',
      weekdays: [...new Set(f.weekdays)].sort((a, b) => a - b),
      ...base,
    };
  }
  return {
    kind: 'cycle',
    daysOn: Number(f.daysOn.trim()),
    daysOff: Number(f.daysOff.trim()),
    cycleStart: f.cycleStart,
    ...base,
  };
}

/** The API body for `POST rotas/{r}/patterns/generate`. */
export function patternBody(f: PatternFields, preview: boolean): Record<string, unknown> {
  const rule = patternRule(f);
  const body: Record<string, unknown> = {
    kind: rule.kind,
    from_date: rule.from,
    to_date: rule.to,
    blocks: rule.blocks.map((b) => ({ start: b.start, end: b.end })),
    staff_profile_id: f.staffProfileId || null,
    location_id: f.locationId || null,
    shift_type_id: f.shiftTypeId || null,
    break_minutes: parseBreak(f.breakRaw) ?? 0,
    notes: f.notes.trim() === '' ? null : f.notes.trim(),
    preview,
  };
  if (rule.kind === 'weekly') body.weekdays = rule.weekdays;
  else {
    body.days_on = rule.daysOn;
    body.days_off = rule.daysOff;
    body.cycle_start = rule.cycleStart;
  }
  return body;
}

/** One line on what a generation did, or (preview) would do. */
export function generateHeadline(r: { created: number; preview?: boolean }): string {
  const noun = r.created === 1 ? 'draft shift' : 'draft shifts';
  if (r.preview) {
    return r.created === 0
      ? 'This would not create any shifts.'
      : `Would create ${r.created} ${noun}.`;
  }
  return r.created === 0
    ? 'No draft shifts were created.'
    : `Created ${r.created} ${noun}.`;
}

const SKIP_LABELS: Record<string, string> = {
  overlap: 'Person already working then',
  duplicate: 'Already on the rota',
};

/** Skipped shifts grouped by reason, biggest group first. */
export function groupSkipped(
  skipped: readonly { reason: string }[],
): { reason: string; label: string; count: number }[] {
  const n = new Map<string, number>();
  for (const s of skipped) n.set(s.reason, (n.get(s.reason) ?? 0) + 1);
  return [...n.entries()]
    .map(([reason, count]) => ({
      reason,
      label: SKIP_LABELS[reason] ?? 'Skipped',
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Publish preview: how many shifts of each kind of change. */
export function countChanges(rows: readonly { change: string }[]): {
  new: number;
  unchanged: number;
  cancelled: number;
} {
  const out = { new: 0, unchanged: 0, cancelled: 0 };
  for (const r of rows) {
    if (r.change === 'new') out.new += 1;
    else if (r.change === 'cancelled') out.cancelled += 1;
    else out.unchanged += 1;
  }
  return out;
}

/** The person's live shifts that fall inside approved leave, for the leave decision dialog. */
export function leaveClashes<
  T extends {
    staff_profile_id: string | null;
    status: string;
    starts_at: string;
    ends_at: string;
  },
>(
  shifts: readonly T[],
  staffId: string,
  startDate: string,
  endDate: string,
  tz: string,
): T[] {
  const from = Date.parse(zonedToUtc(startDate, '00:00', tz));
  const to = Date.parse(zonedToUtc(addDays(endDate, 1), '00:00', tz));
  return shifts.filter(
    (x) =>
      x.staff_profile_id === staffId &&
      x.status !== 'cancelled' &&
      Date.parse(x.starts_at) < to &&
      Date.parse(x.ends_at) > from,
  );
}
