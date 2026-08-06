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
