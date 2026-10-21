/**
 * Dates, times and counts, formatted in one place.
 *
 * Screens have each been writing `toLocaleString('en-GB')` inline, which
 * agrees today only because every call site happened to pick the same
 * locale. This module is where that choice lives, so a later move to the
 * reader's own locale is one edit rather than a hunt through every page.
 * New screens use it; old ones adopt it as they are touched.
 *
 * ## Why the locale is fixed
 *
 * Every string in the product is an English literal (there is no i18n layer,
 * see `PreferencesPage`). Formatting dates for a French browser inside an
 * English sentence produces "Due 3 mars 2027", which is worse than either.
 * So the locale is the product's, `en-GB`, until the copy itself can follow.
 *
 * ## Date-only values are not instants
 *
 * A Postgres `date` arrives as `YYYY-MM-DD`. `new Date('2027-03-03')` reads
 * that as midnight UTC, and formatting it in a zone west of Greenwich shows
 * the day before. `formatDate` reads the components and formats them in UTC,
 * so the day printed is the day stored, in every zone. The suite runs in
 * Europe/London and CI builds in UTC; both must agree.
 */

export const APP_LOCALE = 'en-GB';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const dateFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const dateTimeFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
});

const countFormatter = new Intl.NumberFormat(APP_LOCALE);

/**
 * A calendar date, "3 March 2027". Takes a `YYYY-MM-DD` string and prints
 * exactly that day. Anything else that parses is treated as an instant and
 * printed in UTC; anything that does not parse is returned unchanged rather
 * than as "Invalid Date".
 */
export function formatDate(value: string): string {
  const match = DATE_ONLY.exec(value);
  const instant = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : new Date(value);
  return Number.isNaN(instant.getTime()) ? value : dateFormatter.format(instant);
}

/** An instant in the reader's own zone, "3 Mar 2027, 14:05". */
export function formatDateTime(value: string | Date): string {
  const instant = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(instant.getTime())
    ? String(value)
    : dateTimeFormatter.format(instant);
}

/** A time of day in the reader's own zone, "14:05". */
export function formatTime(value: string | Date): string {
  const instant = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(instant.getTime()) ? String(value) : timeFormatter.format(instant);
}

/** A whole-number count with thousands separators, "12,400". */
export function formatCount(value: number): string {
  return countFormatter.format(value);
}
