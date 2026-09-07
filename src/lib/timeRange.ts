/**
 * How a shift's start and end are written, everywhere.
 *
 * ## Why this is a module and not a template literal
 *
 * The product had at least three spellings of the same fact. The rota chip
 * wrote `07:00, 15:00`, which reads as two separate times rather than a span;
 * the clock-in screen and the marketing preview used a hyphen; the schedule
 * wrote it a third way again. A range separator is a typographic decision, and
 * one shared by every screen that shows a shift, so it belongs in one place.
 *
 * ## The en dash, and the overnight marker
 *
 * U+2013 is the range dash. A hyphen reads as a break inside a compound word,
 * so a hyphenated range looks like a single token where an en-dashed one looks
 * like a span between two.
 *
 * A night shift is the case that actually costs money. A range ending earlier
 * than it starts is ambiguous on its face — an eight-hour night, or a reader's
 * assumption that somebody mistyped it — and staff do turn up on the wrong
 * day. When the end is not after the start, the range says so.
 */

/** The range separator. Never write a hyphen or a comma between two times. */
export const RANGE_DASH = '–';

/** `HH:MM` in 24-hour form, which is what every caller here already holds. */
type Clock = string;

/**
 * True when the end time is at or before the start, i.e. the shift crosses
 * midnight. Purely lexical, which is correct for zero-padded `HH:MM`.
 */
export function crossesMidnight(start: Clock, end: Clock): boolean {
  return end <= start;
}

export interface TimeRangeOptions {
  /**
   * `full` appends ` (+1 day)`; `compact` appends a bare `+1`, for a rota chip
   * roughly 70px wide where the long form would truncate the times it is meant
   * to clarify. `none` suppresses it — only for somewhere the date is already
   * unambiguous on the same line.
   */
  overnight?: 'full' | 'compact' | 'none';
}

/**
 * The canonical range, e.g. an early shift as `07:00`–`15:00`, or a night as
 * `23:00`–`07:00` followed by `(+1 day)`.
 */
export function formatTimeRange(
  start: Clock,
  end: Clock,
  { overnight = 'full' }: TimeRangeOptions = {},
): string {
  const base = `${start}${RANGE_DASH}${end}`;
  if (overnight === 'none' || !crossesMidnight(start, end)) return base;
  return overnight === 'compact' ? `${base} +1` : `${base} (+1 day)`;
}

/**
 * The same range as a sentence, for an `aria-label` or a tooltip.
 *
 * A screen reader reads an en-dashed range as two numbers with a pause; "07:00
 * to 15:00" is what a person would say.
 */
export function describeTimeRange(start: Clock, end: Clock): string {
  const base = `${start} to ${end}`;
  return crossesMidnight(start, end) ? `${base} the next day` : base;
}
