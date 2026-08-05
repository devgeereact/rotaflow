import { differenceInCalendarDays, isValid, parseISO } from 'date-fns';

/**
 * Delivery tallies for `/admin/notifications`.
 *
 * Pure, and in `lib` rather than `services`, for the usual reason: the service
 * layer imports the Supabase client, which reaches for a WebSocket Node does
 * not have.
 */

/** The notification columns the console reads. */
export interface NotificationRow {
  org_id: string;
  channel: string;
  type: string;
  read_at: string | null;
  created_at: string;
}

export interface NotificationSummary {
  total: number;
  read: number;
  unread: number;
  /** Delivered within the last seven calendar days. */
  recent: number;
  /** Distinct organisations that received at least one. */
  organisations: number;
  byChannel: { label: string; value: number }[];
  byType: { label: string; value: number }[];
}

function tally(rows: readonly string[]): { label: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const raw of rows) {
    const label = raw?.trim() ? raw.trim() : 'Unknown';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return (
    [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      // Alphabetical on a tie so the order does not flicker between reads.
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
  );
}

/**
 * Summarise a window of notifications.
 *
 * `read_at` is the only signal of engagement in the schema — there is no
 * delivered, bounced or failed column — so "read" here means the recipient
 * opened it in the app, and an unread notification may have been delivered
 * perfectly and simply not looked at. The screen must not call this a delivery
 * rate.
 */
export function summariseNotifications(
  rows: readonly NotificationRow[],
  now: Date,
): NotificationSummary {
  let read = 0;
  let recent = 0;
  const orgs = new Set<string>();

  for (const row of rows) {
    if (row.read_at) read += 1;
    if (row.org_id) orgs.add(row.org_id);
    const created = parseISO(row.created_at);
    // Calendar days, not a 7 × 86,400,000 subtraction: the suite runs in
    // Europe/London and CI builds in UTC, and neither has 24-hour days across
    // a DST boundary.
    if (isValid(created) && differenceInCalendarDays(now, created) <= 7) recent += 1;
  }

  return {
    total: rows.length,
    read,
    unread: rows.length - read,
    recent,
    organisations: orgs.size,
    byChannel: tally(rows.map((r) => r.channel)),
    byType: tally(rows.map((r) => r.type)),
  };
}

/**
 * What the console reference's Notifications screen offers that this
 * deployment cannot, and why.
 */
export const NOTIFICATION_GAPS: readonly { title: string; detail: string }[] = [
  {
    title: 'No platform announcements',
    detail:
      'The notifications table addresses rows to one user inside one organisation. There is no table for a platform-wide message, no audience definition, and no fan-out — so there is nothing to compose here.',
  },
  {
    title: 'No delivery telemetry',
    detail:
      'The schema records read_at and nothing else. Sent, delivered, bounced and failed are not columns, so a delivery rate would be a guess dressed as a percentage.',
  },
  {
    title: 'Client cannot insert',
    detail:
      'The notifications table has no client insert policy by design — rows are written by Edge Functions holding the service role. A compose form in this console would have nowhere to post.',
  },
  {
    title: 'No scheduling',
    detail:
      'Nothing stores a future send time or a recurrence, so a scheduled maintenance notice cannot be queued from here.',
  },
] as const;
