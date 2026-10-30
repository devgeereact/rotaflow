import { API_BASE_URL, api, orgPath } from '@/lib/api';
import { appUrlFor } from '@/lib/appOrigin';
import { CALENDAR_FEED_KEY_PREFIX, type CalendarFeedRow } from '@/lib/calendarFeed';

/**
 * A person's own calendar subscription (CAP-063). The API issues a token, keeps only its hash, revokes the previous
 * one in the same transaction, and switches an unused feed off after 90 days. The feed itself is the public
 * `GET /api/ics?token=…` route.
 */

function remember(orgId: string, token: string | null): void {
  try {
    if (token) window.localStorage.setItem(CALENDAR_FEED_KEY_PREFIX + orgId, token);
    else window.localStorage.removeItem(CALENDAR_FEED_KEY_PREFIX + orgId);
  } catch {
    // Storage unavailable: the link is simply not shown again on this device.
  }
}

function remembered(orgId: string): string {
  try {
    return window.localStorage.getItem(CALENDAR_FEED_KEY_PREFIX + orgId) ?? '';
  } catch {
    return '';
  }
}

/** The live feed, or null. `token` is empty when the link was issued on another device. */
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
    token: remembered(orgId),
    created_at: r.created_at,
    last_used_at: r.last_used_at,
  };
}

export async function issueMyCalendarFeedToken(orgId: string): Promise<string> {
  const r = await api.post<{ token: string }>(orgPath(orgId, '/calendar-feed/issue'));
  remember(orgId, r.token);
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
