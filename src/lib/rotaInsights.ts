import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import type {
  Availability,
  StaffDocument,
  LeaveRequest,
  Location,
  MinimumCoverRule,
  Shift,
  ShiftType,
  StaffProfile,
} from '@/types';

/**
 * Rota insights. The deterministic half of RotaFlow's rota assistant.
 *
 * Everything here is computed from rows the org already has: shifts, approved
 * leave, declared availability, contracted hours and document expiry. It flags
 * the problems a rota is about to cause and ranks who could cover an open
 * shift, with the reasons written out.
 *
 * Deliberately separate from the language model in
 * `supabase/functions/ai-rota-assistant`. That reads the same facts and writes
 * prose about them; this one *is* the facts, so it works with no API key, no
 * network and no chance of a confident invention. Anything a manager might act
 * on, "this person is on leave", "nobody is covering Saturday night", is
 * decided here, and the model is left to phrase things, never to decide them.
 *
 * Pure functions only, no service imports: this file is unit-tested under Node,
 * where importing `src/services/*` drags in a Supabase client that needs a
 * WebSocket the runtime does not have.
 */

// The Working Time Regulations 1998 give an adult worker 11 consecutive hours'
// rest in each 24-hour period. Anything shorter is a real compliance risk, not
// a style preference, so it is flagged rather than silently scheduled.
const MIN_REST_HOURS = 11;
/** Contracted hours are a target, not a ceiling, only flag a real overrun. */
const OVER_CONTRACT_TOLERANCE = 1.25;
/** A qualification lapsing inside this window needs booking now, not later. */
const DOC_EXPIRY_WARN_DAYS = 30;

export type InsightSeverity = 'critical' | 'warning' | 'info';

export type InsightKind =
  | 'open_shift'
  | 'leave_clash'
  | 'unavailable'
  | 'double_booked'
  | 'rest_breach'
  | 'over_contract'
  | 'document_expiry'
  | 'under_minimum_cover';

export interface RotaInsight {
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  detail: string;
  /** The local date the issue lands on, 'YYYY-MM-DD'. Null when period-wide. */
  date: string | null;
  staffProfileId: string | null;
  shiftId: string | null;
}

export interface RotaInsightInput {
  shifts: Shift[];
  staff: StaffProfile[];
  shiftTypes: ShiftType[];
  locations: Location[];
  /** Approved leave overlapping the period. Pending leave is not a clash yet. */
  leave: LeaveRequest[];
  availability: Availability[];
  documents: StaffDocument[];
  /**
   * Each site's staffing minimum, one row per weekday. See
   * 0036_minimum_cover_rules.sql. Optional and defaults to none, so callers
   * that predate this check (the assistant panel, the shift inspector, the
   * preview page) keep compiling and keep their old behaviour untouched.
   */
  minimumCoverRules?: MinimumCoverRule[];
  /**
   * The calendar dates ('YYYY-MM-DD', local) the minimum-cover check should
   * walk, independent of which dates actually have a shift. Without this a
   * site with a minimum set and zero shifts assigned on a given day would
   * never be flagged, the exact case the check exists for. Optional; the
   * check is skipped entirely when omitted.
   */
  coverDates?: string[];
  timezone: string;
  /** Injected so every rule agrees on "now" and tests can pin it. */
  now: number;
}

const SEVERITY_RANK: Record<InsightSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function localDate(iso: string, timezone: string): string {
  return format(toZonedTime(new Date(iso), timezone), 'yyyy-MM-dd');
}

function localTime(iso: string, timezone: string): string {
  return format(toZonedTime(new Date(iso), timezone), 'HH:mm');
}

function dayLabel(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function fullName(person: StaffProfile): string {
  return `${person.first_name} ${person.last_name}`;
}

/** Net paid minutes of a shift. Elapsed time less the unpaid break. */
export function shiftNetMinutes(shift: Shift): number {
  const elapsed =
    (new Date(shift.ends_at).getTime() - new Date(shift.starts_at).getTime()) / 60_000;
  return Math.max(0, elapsed - shift.break_minutes);
}

/**
 * `weekday` on `availability` is Postgres' 0=Sunday convention (the seed and
 * the Availability screen both write it that way), which is also what
 * JavaScript's `Date.getDay()` returns, so they compare directly.
 */
function weekdayOf(dateIso: string): number {
  return new Date(`${dateIso}T00:00:00`).getDay();
}

function leaveCovers(leave: LeaveRequest, dateIso: string): boolean {
  return leave.start_date <= dateIso && leave.end_date >= dateIso;
}

// KNOWN GAP: this only ever looks at `status`, never `start_time`/`end_time`.
// A staff member who declares "Available Monday 09:00–13:00" (mornings only)
// reads as free all Monday — this only catches a whole day marked
// `unavailable`. `suggestCoverForShift` has the same gap. Closing it means
// comparing the shift's own time-of-day against the declared window, which
// needs its own pass rather than folding into this bug-fix sweep.
function unavailableOn(entry: Availability, dateIso: string): boolean {
  if (entry.status !== 'unavailable') return false;
  if (entry.date) return entry.date === dateIso;
  if (entry.weekday === null) return false;
  return entry.recurring && entry.weekday === weekdayOf(dateIso);
}

function overlaps(a: Shift, b: Shift): boolean {
  return (
    new Date(a.starts_at) < new Date(b.ends_at) &&
    new Date(b.starts_at) < new Date(a.ends_at)
  );
}

/** ISO Monday-based week key, so weekly hour totals group the way a rota does. */
function weekKey(iso: string, timezone: string): string {
  const zoned = toZonedTime(new Date(iso), timezone);
  const day = (zoned.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(zoned);
  monday.setDate(zoned.getDate() - day);
  return format(monday, 'yyyy-MM-dd');
}

/**
 * Every problem the visible rota is about to cause, worst first.
 *
 * Shifts already in the past are skipped for everything a manager could still
 * change. There is no point warning that last Tuesday was understaffed. Only
 * document expiry looks backwards, because an expired certificate is still
 * expired today.
 */
export function computeRotaInsights(input: RotaInsightInput): RotaInsight[] {
  const { shifts, staff, shiftTypes, locations, leave, availability, documents } = input;
  const { minimumCoverRules = [], coverDates = [], timezone, now } = input;

  const staffById = new Map(staff.map((s) => [s.id, s]));
  const typeById = new Map(shiftTypes.map((t) => [t.id, t]));
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const insights: RotaInsight[] = [];

  // Each shift's OWN site's timezone, not the single `timezone` this
  // function was called with — a multi-site org can span timezones, and the
  // grid's chips/totals already read `location.timezone` per shift. Using
  // one blanket timezone here meant a shift near midnight could bucket to
  // the wrong local day, so `leaveCovers`/`unavailableOn` (which compare by
  // that date) missed a real clash on the day the chip actually sits in.
  const timezoneFor = (shift: Shift): string =>
    (shift.location_id ? locationById.get(shift.location_id)?.timezone : undefined) ??
    timezone;

  const live = shifts.filter((s) => s.status !== 'cancelled');
  const upcoming = live.filter((s) => new Date(s.ends_at).getTime() > now);

  // ---- 1. Open shifts, grouped so "3 unfilled nights" is one line ----
  const openGroups = new Map<string, Shift[]>();
  for (const shift of upcoming) {
    if (shift.staff_profile_id) continue;
    const key = [
      localDate(shift.starts_at, timezoneFor(shift)),
      shift.location_id,
      shift.shift_type_id,
      shift.starts_at,
    ].join('|');
    openGroups.set(key, [...(openGroups.get(key) ?? []), shift]);
  }
  for (const group of openGroups.values()) {
    const first = group[0];
    if (!first) continue;
    const firstTz = timezoneFor(first);
    const date = localDate(first.starts_at, firstTz);
    const daysAway = (new Date(first.starts_at).getTime() - now) / 86_400_000;
    const type = first.shift_type_id ? typeById.get(first.shift_type_id) : undefined;
    const location = first.location_id ? locationById.get(first.location_id) : undefined;
    insights.push({
      id: `open:${first.id}`,
      kind: 'open_shift',
      // Inside a week there is no time left to recruit or train. It has to be
      // covered from the people already on the roster, so it escalates.
      severity: daysAway <= 7 ? 'critical' : 'warning',
      title: `${group.length} unfilled ${type?.name ?? 'shift'}${group.length > 1 ? 's' : ''} · ${dayLabel(date)}`,
      detail: `${localTime(first.starts_at, firstTz)}, ${localTime(first.ends_at, firstTz)} at ${location?.name ?? 'an unnamed site'}. Nobody is assigned${daysAway <= 7 ? ' and it starts within the week' : ''}.`,
      date,
      staffProfileId: null,
      shiftId: first.id,
    });
  }

  // ---- 1b. Below a site's staffing minimum for the day ----
  // The minimum is set per site per weekday (0036_minimum_cover_rules.sql).
  // A day with no rule at all is not flagged: silence means the manager has
  // not set a minimum for that site, not that zero people are required.
  //
  // Walked from `locations` x `coverDates`, not from the shifts that happen
  // to exist, so a site with a minimum set and nobody at all assigned that
  // day is still flagged. Grouping by the shifts present would silently miss
  // exactly that case.
  if (minimumCoverRules.length > 0 && coverDates.length > 0) {
    // Only rules for a location actually in scope — `minimumCoverRules` is
    // callers' org-wide list (RotaBuilderPage passes it unfiltered), while
    // `locations` is the location filter on screen. Without this, picking a
    // single site in the filter still evaluates every other site's minimum
    // against a headcount of zero and blocks Publish over a site the manager
    // isn't even looking at.
    const rulesByLocation = new Map<string, Map<number, number>>();
    for (const rule of minimumCoverRules) {
      if (!locationById.has(rule.location_id)) continue;
      const byWeekday =
        rulesByLocation.get(rule.location_id) ?? new Map<number, number>();
      byWeekday.set(rule.weekday, rule.min_staff);
      rulesByLocation.set(rule.location_id, byWeekday);
    }

    // Distinct staff actually on shift, per site per local date. Two shifts
    // for the same person the same day still count once. `live`, not
    // `upcoming`: today's shifts that have already ended by `now` are still
    // real cover that happened today, not a shortfall. `upcoming`'s
    // ends_at > now filter drops them, which read every fully-staffed site
    // as critically understaffed every evening once its day shift finished.
    const onShiftByLocationDate = new Map<string, Set<string>>();
    for (const shift of live) {
      if (!shift.staff_profile_id || !shift.location_id) continue;
      const key = `${shift.location_id}|${localDate(shift.starts_at, timezoneFor(shift))}`;
      const staffOnShift = onShiftByLocationDate.get(key) ?? new Set<string>();
      staffOnShift.add(shift.staff_profile_id);
      onShiftByLocationDate.set(key, staffOnShift);
    }

    const today = localDate(new Date(now).toISOString(), timezone);
    for (const [locationId, byWeekday] of rulesByLocation) {
      const location = locationById.get(locationId);
      for (const date of coverDates) {
        if (date < today) continue; // past days can no longer be changed
        const minStaff = byWeekday.get(weekdayOf(date));
        if (minStaff === undefined || minStaff === 0) continue;
        const onShift = onShiftByLocationDate.get(`${locationId}|${date}`)?.size ?? 0;
        if (onShift >= minStaff) continue;
        const short = minStaff - onShift;
        insights.push({
          id: `cover:${locationId}:${date}`,
          kind: 'under_minimum_cover',
          severity: 'critical',
          title: `${dayLabel(date)} is ${short} short of the ${minStaff}-person minimum`,
          detail: `${location?.name ?? 'This site'} has ${onShift} on shift against a minimum of ${minStaff}.`,
          date,
          staffProfileId: null,
          shiftId: null,
        });
      }
    }
  }

  // ---- Per-person rules ------------------------------------------------
  const byStaff = new Map<string, Shift[]>();
  for (const shift of live) {
    if (!shift.staff_profile_id) continue;
    byStaff.set(shift.staff_profile_id, [
      ...(byStaff.get(shift.staff_profile_id) ?? []),
      shift,
    ]);
  }

  for (const [staffProfileId, personShifts] of byStaff) {
    const person = staffById.get(staffProfileId);
    if (!person) continue;
    const name = fullName(person);
    const ahead = personShifts
      .filter((s) => new Date(s.ends_at).getTime() > now)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

    // ---- 2. Rostered inside approved leave ----
    const personLeave = leave.filter(
      (l) => l.staff_profile_id === staffProfileId && l.status === 'approved',
    );
    for (const shift of ahead) {
      const shiftTz = timezoneFor(shift);
      const date = localDate(shift.starts_at, shiftTz);
      const clash = personLeave.find((l) => leaveCovers(l, date));
      if (!clash) continue;
      insights.push({
        id: `leave:${shift.id}`,
        kind: 'leave_clash',
        severity: 'critical',
        title: `${name} is on approved leave but rostered`,
        detail: `${dayLabel(date)} · ${localTime(shift.starts_at, shiftTz)}, ${localTime(shift.ends_at, shiftTz)}. Approved ${clash.type} runs ${dayLabel(clash.start_date)} to ${dayLabel(clash.end_date)}.`,
        date,
        staffProfileId,
        shiftId: shift.id,
      });
    }

    // ---- 3. Rostered on a day they declared unavailable ----
    const personAvailability = availability.filter(
      (a) => a.staff_profile_id === staffProfileId,
    );
    for (const shift of ahead) {
      const shiftTz = timezoneFor(shift);
      const date = localDate(shift.starts_at, shiftTz);
      if (!personAvailability.some((a) => unavailableOn(a, date))) continue;
      insights.push({
        id: `unavailable:${shift.id}`,
        kind: 'unavailable',
        severity: 'warning',
        title: `${name} is marked unavailable`,
        detail: `Rostered ${dayLabel(date)} · ${localTime(shift.starts_at, shiftTz)}, ${localTime(shift.ends_at, shiftTz)}, against their declared availability.`,
        date,
        staffProfileId,
        shiftId: shift.id,
      });
    }

    // ---- 4. Overlapping shifts ----
    for (let i = 0; i < ahead.length; i += 1) {
      for (let j = i + 1; j < ahead.length; j += 1) {
        const a = ahead[i];
        const b = ahead[j];
        if (!a || !b || !overlaps(a, b)) continue;
        const aTz = timezoneFor(a);
        const date = localDate(a.starts_at, aTz);
        insights.push({
          id: `clash:${a.id}:${b.id}`,
          kind: 'double_booked',
          severity: 'critical',
          title: `${name} is double-booked`,
          detail: `${dayLabel(date)} · ${localTime(a.starts_at, aTz)}, ${localTime(a.ends_at, aTz)} overlaps ${localTime(b.starts_at, timezoneFor(b))}, ${localTime(b.ends_at, timezoneFor(b))}. One of the two needs reassigning.`,
          date,
          staffProfileId,
          shiftId: b.id,
        });
      }
    }

    // ---- 5. Rest between consecutive shifts ----
    // Sorted from ALL of this person's shifts, not just `ahead` — a shift
    // that ended an hour ago is still the thing an upcoming shift's rest is
    // measured against. Using `ahead` alone made the very first upcoming
    // shift of any period rest-check-blind, since its real predecessor had
    // already dropped out of the list. Only push an insight when `next`
    // itself is still actionable (in `ahead`) — a breach entirely in the
    // past isn't something a manager can still fix.
    const allSorted = [...personShifts].sort((a, b) =>
      a.starts_at.localeCompare(b.starts_at),
    );
    const aheadIds = new Set(ahead.map((s) => s.id));
    for (let i = 1; i < allSorted.length; i += 1) {
      const previous = allSorted[i - 1];
      const next = allSorted[i];
      if (!previous || !next || !aheadIds.has(next.id)) continue;
      const restHours =
        (new Date(next.starts_at).getTime() - new Date(previous.ends_at).getTime()) /
        3_600_000;
      if (restHours < 0 || restHours >= MIN_REST_HOURS) continue;
      const nextTz = timezoneFor(next);
      const previousTz = timezoneFor(previous);
      const date = localDate(next.starts_at, nextTz);
      insights.push({
        id: `rest:${next.id}`,
        kind: 'rest_breach',
        severity: 'warning',
        title: `${name} has only ${restHours.toFixed(1)}h rest`,
        detail: `Off at ${localTime(previous.ends_at, previousTz)} on ${dayLabel(localDate(previous.starts_at, previousTz))}, back at ${localTime(next.starts_at, nextTz)} on ${dayLabel(date)}. The Working Time Regulations expect ${MIN_REST_HOURS}h.`,
        date,
        staffProfileId,
        shiftId: next.id,
      });
    }

    // ---- 6. Scheduled well over contracted hours ----
    const contracted = Number(person.weekly_hours ?? 0);
    if (contracted > 0) {
      // Summed from every shift in the week, not just `ahead` — the title
      // below states the week's total, and hours already worked count
      // towards a real overrun exactly as much as hours still to come.
      // `ahead` still decides which weeks are worth surfacing: a week
      // that's entirely in the past has nothing left for a manager to move.
      const byWeek = new Map<string, number>();
      for (const shift of personShifts) {
        const key = weekKey(shift.starts_at, timezone);
        byWeek.set(key, (byWeek.get(key) ?? 0) + shiftNetMinutes(shift) / 60);
      }
      const actionableWeeks = new Set(ahead.map((s) => weekKey(s.starts_at, timezone)));
      for (const [week, hours] of byWeek) {
        if (!actionableWeeks.has(week)) continue;
        if (hours <= contracted * OVER_CONTRACT_TOLERANCE) continue;
        insights.push({
          id: `hours:${staffProfileId}:${week}`,
          kind: 'over_contract',
          severity: 'warning',
          title: `${name} is scheduled ${hours.toFixed(1)}h against a ${contracted}h contract`,
          detail: `Week commencing ${dayLabel(week)}. That is ${(hours - contracted).toFixed(1)}h of overtime to authorise, or work to move to someone with headroom.`,
          date: week,
          staffProfileId,
          shiftId: null,
        });
      }
    }

    // ---- 7. Qualifications lapsing while they are still rostered ----
    if (ahead.length > 0) {
      for (const doc of documents.filter((d) => d.staff_profile_id === staffProfileId)) {
        if (!doc.expires_at) continue;
        const daysLeft =
          (new Date(`${doc.expires_at}T00:00:00`).getTime() - now) / 86_400_000;
        if (daysLeft > DOC_EXPIRY_WARN_DAYS) continue;
        const expired = daysLeft < 0;
        insights.push({
          id: `doc:${doc.id}`,
          kind: 'document_expiry',
          severity: expired ? 'critical' : 'warning',
          title: `${name}: ${doc.name} ${expired ? 'has expired' : 'expires soon'}`,
          detail: expired
            ? `Expired ${dayLabel(doc.expires_at)} and they are still on the rota. Check whether they are eligible to work.`
            : `Expires ${dayLabel(doc.expires_at)}, in ${Math.ceil(daysLeft)} days. Book the renewal before it blocks a shift.`,
          date: doc.expires_at,
          staffProfileId,
          shiftId: null,
        });
      }
    }
  }

  return insights.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return (a.date ?? '').localeCompare(b.date ?? '');
  });
}

/** Headline counts for the assistant's summary line. */
export interface InsightSummary {
  critical: number;
  warning: number;
  openShifts: number;
  /** Assigned slots ÷ all slots across the visible period, 0-100. */
  coveragePct: number;
  headline: string;
}

export function summariseInsights(
  insights: RotaInsight[],
  shifts: Shift[],
  now: number,
): InsightSummary {
  const critical = insights.filter((i) => i.severity === 'critical').length;
  const warning = insights.filter((i) => i.severity === 'warning').length;

  const upcoming = shifts.filter(
    (s) => s.status !== 'cancelled' && new Date(s.ends_at).getTime() > now,
  );
  const openShifts = upcoming.filter((s) => !s.staff_profile_id).length;
  const coveragePct =
    upcoming.length === 0
      ? 100
      : Math.round(((upcoming.length - openShifts) / upcoming.length) * 100);

  let headline: string;
  if (upcoming.length === 0) {
    headline =
      'Nothing left to cover in this period. Every shift here has already been worked.';
  } else if (critical === 0 && warning === 0) {
    headline = `All ${upcoming.length} upcoming shifts are covered and nothing is flagged. This period is ready to publish.`;
  } else if (critical > 0) {
    headline = `${critical} thing${critical === 1 ? '' : 's'} need${critical === 1 ? 's' : ''} fixing before this is publishable${warning > 0 ? `, plus ${warning} worth a look` : ''}. Coverage is ${coveragePct}%.`;
  } else {
    headline = `Nothing blocking, but ${warning} thing${warning === 1 ? '' : 's'} worth a look. Coverage is ${coveragePct}%.`;
  }

  return { critical, warning, openShifts, coveragePct, headline };
}

// =====================================================================
// Who could cover an open shift
// =====================================================================

export interface CoverCandidate {
  staffProfileId: string;
  name: string;
  jobTitle: string | null;
  /** 0-100. Only meaningful for ranking within one shift's candidates. */
  score: number;
  /** Why they fit. Shown to the manager so the ranking is auditable. */
  reasons: string[];
  /** Why they might not. A candidate with a hard blocker is never eligible. */
  blockers: string[];
  eligible: boolean;
}

export interface CoverSuggestionInput {
  shift: Shift;
  /** Every shift in the period, used for conflicts, rest and hours. */
  shifts: Shift[];
  staff: StaffProfile[];
  leave: LeaveRequest[];
  availability: Availability[];
  timezone: string;
}

/**
 * Rank who could work an open shift, with the reasoning attached.
 *
 * The score exists only to order one shift's candidates; it is not a
 * percentage of anything and is never shown as one. Hard blockers. Approved
 * leave, an overlapping shift, a declared unavailability. Drop a candidate
 * out of eligibility entirely rather than costing them points, because no
 * amount of "good fit" makes it legal to roster someone who is on holiday.
 *
 * Everything is derived from rows that exist. There is no required-skills
 * column on `shifts`, so "right skills" means overlapping with the people who
 * normally work this pattern here, an observation, not an invented rule.
 */
export function suggestCoverForShift(input: CoverSuggestionInput): CoverCandidate[] {
  const { shift, shifts, staff, leave, availability, timezone } = input;
  const date = localDate(shift.starts_at, timezone);
  const shiftStart = new Date(shift.starts_at).getTime();
  const shiftEnd = new Date(shift.ends_at).getTime();
  const shiftHours = shiftNetMinutes(shift) / 60;
  const week = weekKey(shift.starts_at, timezone);

  // The skills held by people who usually work this pattern at this site.
  const regulars = shifts.filter(
    (s) =>
      s.id !== shift.id &&
      s.staff_profile_id &&
      s.shift_type_id === shift.shift_type_id &&
      s.location_id === shift.location_id,
  );
  const patternSkills = new Set(
    regulars.flatMap((s) => staff.find((p) => p.id === s.staff_profile_id)?.skills ?? []),
  );

  const candidates = staff
    .filter((person) => person.active)
    .map((person): CoverCandidate => {
      const reasons: string[] = [];
      const blockers: string[] = [];
      let score = 40;

      const personShifts = shifts.filter(
        (s) => s.staff_profile_id === person.id && s.status !== 'cancelled',
      );

      // ---- hard blockers ----
      if (
        leave.some(
          (l) =>
            l.staff_profile_id === person.id &&
            l.status === 'approved' &&
            leaveCovers(l, date),
        )
      ) {
        blockers.push('On approved leave that day');
      }
      if (
        personShifts.some(
          (s) =>
            new Date(s.starts_at).getTime() < shiftEnd &&
            shiftStart < new Date(s.ends_at).getTime(),
        )
      ) {
        blockers.push('Already working an overlapping shift');
      }
      if (
        availability.some(
          (a) => a.staff_profile_id === person.id && unavailableOn(a, date),
        )
      ) {
        blockers.push('Marked unavailable that day');
      }

      // ---- soft signals ----
      const sameType = personShifts.filter(
        (s) => s.shift_type_id === shift.shift_type_id,
      ).length;
      if (sameType > 0) {
        score += 25;
        reasons.push(`Already works this pattern (${sameType} in this period)`);
      }

      const sameLocation = personShifts.filter(
        (s) => s.location_id === shift.location_id,
      ).length;
      if (sameLocation > 0) {
        score += 15;
        reasons.push('Regularly works this site');
      }

      const skillOverlap = (person.skills ?? []).filter((s) => patternSkills.has(s));
      if (skillOverlap.length > 0) {
        score += 10;
        reasons.push(`Holds ${skillOverlap.slice(0, 2).join(', ')}`);
      }

      const contracted = Number(person.weekly_hours ?? 0);
      const weekHours = personShifts
        .filter((s) => weekKey(s.starts_at, timezone) === week)
        .reduce((total, s) => total + shiftNetMinutes(s) / 60, 0);
      if (contracted > 0) {
        const headroom = contracted - weekHours;
        if (headroom >= shiftHours) {
          score += 20;
          reasons.push(`${headroom.toFixed(1)}h left on a ${contracted}h contract`);
        } else {
          score -= 20;
          blockers.push(
            `Would go ${(shiftHours - headroom).toFixed(1)}h over their ${contracted}h contract`,
          );
        }
      } else {
        // Zero-hours: no contractual ceiling to breach, which is precisely
        // what these contracts are for.
        score += 10;
        reasons.push('Zero-hours, no contracted ceiling');
      }

      // ---- rest around the shift ----
      let tightestRest = Infinity;
      for (const other of personShifts) {
        const otherEnd = new Date(other.ends_at).getTime();
        const otherStart = new Date(other.starts_at).getTime();
        if (otherEnd <= shiftStart) {
          tightestRest = Math.min(tightestRest, (shiftStart - otherEnd) / 3_600_000);
        } else if (otherStart >= shiftEnd) {
          tightestRest = Math.min(tightestRest, (otherStart - shiftEnd) / 3_600_000);
        }
      }
      if (tightestRest < MIN_REST_HOURS) {
        score -= 30;
        blockers.push(`Only ${tightestRest.toFixed(1)}h rest either side`);
      } else if (Number.isFinite(tightestRest)) {
        reasons.push(`${Math.round(tightestRest)}h clear either side`);
      }

      return {
        staffProfileId: person.id,
        name: fullName(person),
        jobTitle: person.job_title,
        score: Math.max(0, Math.min(100, score)),
        reasons,
        blockers,
        // Only the three hard blockers disqualify. Contract overrun and a
        // tight rest gap are decisions for a manager to take knowingly, so
        // they stay visible instead of hiding the only person available.
        eligible: !blockers.some(
          (b) =>
            b.startsWith('On approved leave') ||
            b.startsWith('Already working') ||
            b.startsWith('Marked unavailable'),
        ),
      };
    });

  return candidates
    .filter((c) => c.eligible)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/**
 * Facts about a period, in the shape the language model is handed.
 *
 * Kept here rather than in the edge function so the model is briefed on the
 * *same* numbers the manager can see on screen, a summary computed twice in
 * two places is a summary that will eventually disagree with itself.
 */
export function describePeriodForPrompt(input: RotaInsightInput): string {
  const insights = computeRotaInsights(input);
  const summary = summariseInsights(insights, input.shifts, input.now);
  const lines = [
    summary.headline,
    `Coverage ${summary.coveragePct}%, ${summary.openShifts} unfilled shift(s).`,
    ...insights.slice(0, 12).map((i) => `- [${i.severity}] ${i.title}: ${i.detail}`),
  ];
  return lines.join('\n');
}
