import { API_BASE_URL, api, orgPath } from '@/lib/api';
import { appUrlFor } from '@/lib/appOrigin';
import { CALENDAR_FEED_KEY_PREFIX, type CalendarFeedRow } from '@/lib/calendarFeed';

/**
 * A person's own calendar subscription (CAP-063). The API issues a token, keeps only its hash, revokes the previous
 * one in the same transaction, and switches an unused feed off after 90 days. The feed itself is the public
 * `GET /api/ics?token=…` route.
 */

/**
 * The link is kept with the `created_at` of the feed it belongs to, and shown only while that matches the signed-in
 * person's own active feed. Keyed by organisation alone, a shared device showed one person's private link to the next
 * person who opened the page (security audit, 1 Nov 2026).
 */
function remember(
  orgId: string,
  token: string | null,
  createdAt: string | null = null,
): void {
  try {
    if (token && createdAt) {
      window.localStorage.setItem(
        CALENDAR_FEED_KEY_PREFIX + orgId,
        JSON.stringify({ token, created_at: createdAt }),
      );
    } else window.localStorage.removeItem(CALENDAR_FEED_KEY_PREFIX + orgId);
  } catch {
    // Storage unavailable: the link is simply not shown again on this device.
  }
}

function remembered(orgId: string, createdAt: string): string {
  try {
    const raw = window.localStorage.getItem(CALENDAR_FEED_KEY_PREFIX + orgId);
    if (!raw) return '';
    const kept = JSON.parse(raw) as { token?: unknown; created_at?: unknown };
    return typeof kept.token === 'string' && kept.created_at === createdAt
      ? kept.token
      : '';
  } catch {
    return ''; // includes a link kept in the old plain-text form: it is not shown again
  }
}

export async function getMyCalendarFeed(orgId: string): Promise<CalendarFeedRow | null> {
  const r = await api.get<{
    active: boolean;
    created_at: string | null;
    last_used_at: string | null;
  }>(orgPath(orgId, '/calendar-feed'));
  if (!r.active || !r.created_at) {
    remember(orgId, null);
    return null;
  }
  return {
    token: remembered(orgId, r.created_at),
    created_at: r.created_at,
    last_used_at: r.last_used_at,
  };
}

export async function issueMyCalendarFeedToken(orgId: string): Promise<string> {
  const r = await api.post<{ token: string; created_at: string }>(
    orgPath(orgId, '/calendar-feed/issue'),
  );
  remember(orgId, r.token, r.created_at);
  return r.token;
}

export async function revokeMyCalendarFeedToken(orgId: string): Promise<void> {
  await api.post(orgPath(orgId, '/calendar-feed/revoke'));
  remember(orgId, null);
}

/** The subscription URL a calendar app polls: absolute, on this origin. */
export function calendarFeedUrl(token: string): string {
  return appUrlFor(`${API_BASE_URL}/ics?token=${encodeURIComponent(token)}`);
}
