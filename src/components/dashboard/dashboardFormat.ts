import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

export function timeRange(
  startsAt: string,
  endsAt: string,
  timezone: string,
): [string, string] {
  return [
    format(toZonedTime(new Date(startsAt), timezone), 'HH:mm'),
    format(toZonedTime(new Date(endsAt), timezone), 'HH:mm'),
  ];
}

export function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

/** "N hours" trimmed to one decimal, matching the rota builder's hour formatting. */
export function hoursLabel(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}h`;
}

/**
 * The greeting at the top of a staff member's dashboard, in the organisation's
 * own timezone.
 *
 * It said "Good morning" at every hour of the day until 2026-09-11. This is a
 * product for people who work nights: a care assistant opening the app at the
 * start of a 22:00 shift was told good morning by their employer's software,
 * which is the kind of small wrongness that tells somebody nobody thought
 * about them.
 *
 * The boundaries are the ordinary English ones — afternoon from noon, evening
 * from 18:00 — and the small hours are "evening" rather than a fourth phrase,
 * because "good night" reads as a farewell to somebody arriving for work.
 */
export function greeting(now: Date, timezone: string): string {
  const hour = Number(format(toZonedTime(now, timezone), 'H'));
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  if (hour >= 18 || hour < 5) return 'Good evening';
  return 'Good morning';
}
