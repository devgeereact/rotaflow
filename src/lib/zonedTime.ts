/**
 * Wall-clock time in a named zone, and back to UTC, with no library and no reliance on the
 * browser's own zone. Ported from SiteRelay `src/account/time.ts` (slice S11, scheduling).
 *
 * Managers think in the organisation's local time; the API speaks UTC. A rota pattern says
 * "06:00 to 14:00 every weekday", and that has to stay 06:00 on the far side of a clock change,
 * so patterns are built from local dates and times and only turned into instants here.
 *
 * Pure: no imports, no I/O. Mirrored on the server by `backend/src/SchedulingRules.php`.
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function parts(utcMs: number, tz: string): Parts {
  const o: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') o[p.type] = Number(p.value);
  }
  return {
    year: o.year ?? 0,
    month: o.month ?? 1,
    day: o.day ?? 1,
    hour: o.hour ?? 0,
    minute: o.minute ?? 0,
    second: o.second ?? 0,
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

function splitNumbers(text: string, sep: string): [number, number, number] {
  const [a = 0, b = 0, c = 0] = text.split(sep).map(Number);
  return [a, b, c];
}

/** Offset (local minus UTC) in milliseconds at a UTC instant. */
export function offsetMs(utcMs: number, tz: string): number {
  const p = parts(utcMs, tz);
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
    Math.floor(utcMs / 1000) * 1000
  );
}

/** An instant as ISO 8601 UTC without milliseconds, e.g. 2026-10-26T09:00:00Z. */
export const isoUtc = (ms: number): string =>
  new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Wall-clock date (YYYY-MM-DD) and time (HH:MM) in `tz` to a UTC ISO string. A time skipped by
 * the spring change lands an hour later (01:30 in London on the last Sunday of March is 02:30
 * BST); a time that happens twice in the autumn resolves to the second of the two (GMT). The
 * server uses the same two-pass method, so both sides agree on that one ambiguous hour.
 */
export function zonedToUtc(date: string, time: string, tz: string): string {
  const [y, mo, d] = splitNumbers(date, '-');
  const [h, mi] = splitNumbers(time, ':');
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  let ms = guess - offsetMs(guess, tz);
  ms = guess - offsetMs(ms, tz); // a second pass settles instants near a clock change
  return isoUtc(ms);
}

/** UTC ISO to local wall-clock date and time in `tz`. */
export function utcToZoned(iso: string, tz: string): { date: string; time: string } {
  const p = parts(Date.parse(iso), tz);
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

/** Calendar arithmetic on YYYY-MM-DD, independent of any clock change. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = splitNumbers(date, '-');
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** ISO weekday of a YYYY-MM-DD date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [y, m, d] = splitNumbers(date, '-');
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Monday of the week containing `date`. */
export function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** Whole calendar days from `a` to `b`, independent of any clock change. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = splitNumbers(a, '-');
  const [by, bm, bd] = splitNumbers(b, '-');
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** UTC range covering [startDate 00:00, startDate + days 00:00) local. */
export function localRange(
  startDate: string,
  days: number,
  tz: string,
): { from: string; to: string } {
  return {
    from: zonedToUtc(startDate, '00:00', tz),
    to: zonedToUtc(addDays(startDate, days), '00:00', tz),
  };
}

/** Today's date in `tz`. */
export function todayIn(tz: string, now: number = Date.now()): string {
  return utcToZoned(isoUtc(now), tz).date;
}

/** A finish time at or before the start time means the shift ends the next day. */
export function endDateFor(date: string, start: string, end: string): string {
  return end <= start ? addDays(date, 1) : date;
}
