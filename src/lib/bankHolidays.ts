/**
 * UK bank holidays, computed rather than listed (CAP-009).
 *
 * A rota product that does not know about bank holidays gets two things
 * wrong in the same week: it shows a normal Monday when half the staff assume
 * they are off, and it counts that Monday against somebody's annual leave.
 *
 * ## Why this is computed and not a table
 *
 * A seeded table of dates is right until the year it runs out, and the way it
 * runs out is silent: the product simply stops knowing, in December, for the
 * year everybody is about to plan. Every rule below is deterministic —
 * "the last Monday in May", "the Monday after Easter" — so the arithmetic
 * covers every year without anybody remembering to extend anything.
 *
 * ## What it deliberately cannot know
 *
 * One-off holidays announced by the government — a coronation, a jubilee, a
 * funeral — are political events, not rules, and no algorithm produces them.
 * `EXTRA_HOLIDAYS` is where those go when they are announced, and the fact
 * that it is empty is the honest current state rather than an oversight.
 *
 * ## Regions differ, and getting it wrong is not cosmetic
 *
 * Scotland has no Easter Monday and takes the FIRST Monday in August, not the
 * last. Northern Ireland adds St Patrick's Day and the Twelfth. A product that
 * assumes England for a Glasgow customer rosters people on a public holiday
 * and pays them the wrong rate.
 *
 * Pure: no Supabase, no DOM. Dates are handled as `YYYY-MM-DD` strings and
 * built in UTC, so a machine in one zone and CI in another agree — this
 * project runs its suite in Europe/London and builds in UTC deliberately.
 */

export type BankHolidayRegion = 'england-and-wales' | 'scotland' | 'northern-ireland';

export const REGION_LABELS: Record<BankHolidayRegion, string> = {
  'england-and-wales': 'England and Wales',
  scotland: 'Scotland',
  'northern-ireland': 'Northern Ireland',
};

export interface BankHoliday {
  /** `YYYY-MM-DD`. */
  date: string;
  name: string;
  /** True when the real date fell at a weekend and this is the day off in lieu. */
  substitute: boolean;
}

/**
 * One-off holidays the government announces. Empty, and that is the truth.
 *
 * Add them as `{ region: date: name }` when one is announced; the rules below
 * cannot derive them, and pretending otherwise would be worse than an empty
 * object somebody has to notice.
 */
const EXTRA_HOLIDAYS: Partial<Record<BankHolidayRegion, Record<string, string>>> = {};

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Easter Sunday, by the anonymous Gregorian algorithm.
 *
 * Good Friday and Easter Monday are the only bank holidays that move, and
 * they move by a rule nobody can do in their head — which is exactly why
 * hand-written tables of them go wrong.
 */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** The nth (1-based) given weekday of a month. `0` = Sunday. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = utc(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return addDays(first, offset + (n - 1) * 7);
}

/** The last given weekday of a month. */
function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return addDays(last, -offset);
}

/**
 * Move a weekend date to the next working day.
 *
 * `taken` carries the days already claimed, because Christmas and Boxing Day
 * are adjacent: when the 25th is a Saturday, Christmas moves to the Monday
 * and Boxing Day has to move to the Tuesday rather than landing on top of it.
 * Getting this wrong produces a year with one bank holiday instead of two,
 * which is precisely the week a rota cannot afford to be wrong about.
 */
function substituteIfWeekend(
  date: Date,
  taken: Set<string>,
): { date: Date; moved: boolean } {
  let moved = false;
  let out = date;
  while (out.getUTCDay() === 0 || out.getUTCDay() === 6 || taken.has(iso(out))) {
    out = addDays(out, 1);
    moved = true;
  }
  return { date: out, moved };
}

/**
 * Every bank holiday in a region for a calendar year, in date order.
 */
export function bankHolidays(year: number, region: BankHolidayRegion): BankHoliday[] {
  const easter = easterSunday(year);
  const taken = new Set<string>();
  const out: BankHoliday[] = [];

  /** Fixed-date holidays move when they fall at a weekend. */
  const fixed = (month: number, day: number, name: string): void => {
    const { date, moved } = substituteIfWeekend(utc(year, month, day), taken);
    taken.add(iso(date));
    out.push({
      date: iso(date),
      name: moved ? `${name} (substitute day)` : name,
      substitute: moved,
    });
  };

  /** A holiday that is already a weekday by construction never moves. */
  const onDay = (date: Date, name: string): void => {
    taken.add(iso(date));
    out.push({ date: iso(date), name, substitute: false });
  };

  fixed(1, 1, "New Year's Day");
  if (region === 'scotland') fixed(1, 2, '2 January');
  if (region === 'northern-ireland') fixed(3, 17, "St Patrick's Day");

  onDay(addDays(easter, -2), 'Good Friday');
  // Scotland has no Easter Monday. Rostering one there is a day of cover
  // nobody asked for; leaving it out of England is a day of missing cover.
  if (region !== 'scotland') onDay(addDays(easter, 1), 'Easter Monday');

  onDay(nthWeekday(year, 5, 1, 1), 'Early May bank holiday');
  onDay(lastWeekday(year, 5, 1), 'Spring bank holiday');

  if (region === 'northern-ireland') fixed(7, 12, 'Battle of the Boyne');

  // The one that is genuinely different rather than merely extra: Scotland
  // takes the FIRST Monday in August, everywhere else takes the last.
  onDay(
    region === 'scotland' ? nthWeekday(year, 8, 1, 1) : lastWeekday(year, 8, 1),
    'Summer bank holiday',
  );

  if (region === 'scotland') fixed(11, 30, "St Andrew's Day");

  fixed(12, 25, 'Christmas Day');
  fixed(12, 26, 'Boxing Day');

  for (const [date, name] of Object.entries(EXTRA_HOLIDAYS[region] ?? {})) {
    if (date.startsWith(String(year))) out.push({ date, name, substitute: false });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The bank holidays falling inside a date range, inclusive.
 *
 * Used where the answer changes a decision: a leave request covering one, and
 * a rota week containing one.
 */
export function bankHolidaysBetween(
  startIso: string,
  endIso: string,
  region: BankHolidayRegion,
): BankHoliday[] {
  const startYear = Number(startIso.slice(0, 4));
  const endYear = Number(endIso.slice(0, 4));
  const out: BankHoliday[] = [];

  // A leave request spanning New Year crosses two years, and a range that
  // only looked at the start year would miss the 1st of January — the single
  // most requested day off there is.
  for (let year = startYear; year <= endYear; year += 1) {
    for (const holiday of bankHolidays(year, region)) {
      if (holiday.date >= startIso && holiday.date <= endIso) out.push(holiday);
    }
  }
  return out;
}
