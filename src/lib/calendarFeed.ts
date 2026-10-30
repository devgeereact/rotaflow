/**
 * Whether the signed-in person's calendar feed still works, and what "My rota"
 * should say about it (docs/SAAS.md GAP-052, `0158`).
 *
 * The feed token does not expire on a date: an expiring subscription silently
 * stops updating on somebody's phone. It expires on idleness instead. A token
 * that no calendar has read for {@link FEED_IDLE_DAYS} days (counted from
 * issue when it was never read) is a leftover, not a subscription, and the
 * feed reader revokes it on its next read.
 *
 * Until something reads it, though, the row still has `revoked_at` null. So
 * this module decides from the timestamps, not from `revoked_at` alone, or the
 * screen would offer to copy a link that returns an empty calendar.
 */

/** Mirrors the interval in `calendar_feed_shifts` (`0158`). Change both. */
export const FEED_IDLE_DAYS = 90;

/**
 * The API keeps only a hash of a feed token, so the link can be shown again only on the device that issued it.
 * Stored per organisation under this prefix, and swept on sign-out with the rest of the tenant state.
 */
export const CALENDAR_FEED_KEY_PREFIX = 'rotaflow:calendarFeed:';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The columns of a live `calendar_feed_tokens` row this decision reads. */
export interface CalendarFeedRow {
  token: string;
  created_at: string;
  last_used_at: string | null;
}

export type CalendarFeedState =
  | { kind: 'none' }
  | { kind: 'idle' }
  | { kind: 'live'; token: string; lastUsedAt: string | null };

/**
 * `none` when there is no live row, `idle` when the row has gone unread for
 * longer than the feed reader allows, otherwise `live`.
 *
 * Elapsed time, not calendar days, on purpose: the database compares
 * timestamps with `interval '90 days'`, and this has to agree with it to the
 * hour, whatever the clocks did in between.
 */
export function calendarFeedState(
  row: CalendarFeedRow | null,
  now: Date = new Date(),
): CalendarFeedState {
  if (!row) return { kind: 'none' };
  const lastSeen = Date.parse(row.last_used_at ?? row.created_at);
  if (Number.isNaN(lastSeen)) return { kind: 'idle' };
  if (now.getTime() - lastSeen > FEED_IDLE_DAYS * DAY_MS) return { kind: 'idle' };
  return { kind: 'live', token: row.token, lastUsedAt: row.last_used_at };
}
