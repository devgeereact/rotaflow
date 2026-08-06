import type { Shift, ShiftType } from '@/types';

/**
 * Minimal RFC 5545 iCalendar output for a set of shifts.
 *
 * Timestamps are emitted as UTC (`...Z`), which is what `starts_at`/`ends_at`
 * already are, no timezone maths, and every calendar client renders them in
 * the viewer's own zone, which is the right behaviour for a person looking at
 * their own shifts.
 */

const CRLF = '\r\n';

/** Escape per RFC 5545 §3.3.11. Backslash first, or it double-escapes. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function toIcsStamp(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * Fold lines at 75 octets per RFC 5545 §3.1. Clients are lenient about this,
 * but Outlook is not always, and a long shift note is enough to exceed it.
 */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest.length > 0) parts.push(` ${rest}`);
  return parts.join(CRLF);
}

export interface IcsOptions {
  /** Calendar name shown by the client. */
  calendarName: string;
  shiftTypes?: ShiftType[];
  /** Stamp for DTSTAMP; injected so output is deterministic in tests. */
  now?: Date;
}

export function buildIcs(shifts: Shift[], options: IcsOptions): string {
  const typeById = new Map((options.shiftTypes ?? []).map((t) => [t.id, t]));
  const stamp = toIcsStamp((options.now ?? new Date()).toISOString());

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RotaFlow//Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.calendarName)}`,
  ];

  for (const shift of shifts) {
    const type = shift.shift_type_id ? typeById.get(shift.shift_type_id) : undefined;
    const summary = type?.name ?? 'Shift';

    lines.push(
      'BEGIN:VEVENT',
      // Stable across regenerations, so re-subscribing updates rather than duplicates.
      `UID:${shift.id}@rotaflow`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsStamp(shift.starts_at)}`,
      `DTEND:${toIcsStamp(shift.ends_at)}`,
      `SUMMARY:${escapeText(summary)}`,
    );

    const description: string[] = [];
    if (shift.break_minutes > 0)
      description.push(`Break: ${shift.break_minutes} minutes`);
    if (shift.notes) description.push(shift.notes);
    if (description.length > 0) {
      lines.push(`DESCRIPTION:${escapeText(description.join('\n'))}`);
    }

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join(CRLF) + CRLF;
}

/** Trigger a browser download of the given shifts as an .ics file. */
export function downloadIcs(
  shifts: Shift[],
  filename: string,
  options: IcsOptions,
): void {
  const blob = new Blob([buildIcs(shifts, options)], {
    type: 'text/calendar;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.ics') ? filename : `${filename}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
