// calendar-feed/calendar.ts. RotaFlow
//
// The decision half of `calendar-feed`, with no Deno globals, so vitest can
// run it (the pattern `public-enquiry/validate.ts` set). `index.ts` does the
// I/O: the token shape check, the database call and the response.

export interface FeedShift {
  shift_id: string;
  starts_at: string;
  ends_at: string;
  shift_type: string | null;
  location_name: string | null;
  break_minutes: number;
  notes: string | null;
}

/** `2027-03-04T09:00:00Z` → `20270304T090000Z`. */
function icsStamp(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * RFC 5545 escaping: backslash first, or it escapes the escapes.
 * Newlines become the literal `\n` the format expects.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold to 75 octets, as the spec requires. Long location names and notes
 * genuinely exceed it, and some clients reject the whole calendar over one
 * over-length line rather than skipping it.
 */
export function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest) parts.push(' ' + rest);
  return parts.join('\r\n');
}

export function buildCalendar(shifts: FeedShift[]): string {
  const now = icsStamp(new Date().toISOString());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RotaFlow//Rota//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:My shifts',
    // A polite hint at how often to re-read. Clients treat it as advisory,
    // and most poll less often than asked; there is no way to push.
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];

  for (const shift of shifts) {
    const description: string[] = [];
    if (shift.break_minutes > 0)
      description.push(`Break: ${shift.break_minutes} minutes`);
    if (shift.notes) description.push(shift.notes);

    lines.push(
      'BEGIN:VEVENT',
      // Stable across re-reads, so an amended shift UPDATES the existing
      // event rather than appearing beside it. This is the whole difference
      // between a subscription and a pile of duplicates.
      `UID:${shift.shift_id}@rotaflow`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsStamp(shift.starts_at)}`,
      `DTEND:${icsStamp(shift.ends_at)}`,
      `SUMMARY:${escapeText(shift.shift_type ?? 'Shift')}`,
    );
    if (shift.location_name) lines.push(`LOCATION:${escapeText(shift.location_name)}`);
    if (description.length > 0) {
      lines.push(`DESCRIPTION:${escapeText(description.join('\n'))}`);
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/**
 * True when the feed reader refused the read for being over the hourly
 * allowance (`0158`). `consume_rate_limit` raises P0001 for that and for
 * nothing else the reader does.
 */
export function isRateLimited(error: { code?: string } | null): boolean {
  return error?.code === 'P0001';
}

/**
 * Seconds a refused client should wait. The allowance is a sliding hour, so
 * an hour is the honest upper bound; most clients wait far longer anyway.
 */
export const RETRY_AFTER_SECONDS = 3600;
