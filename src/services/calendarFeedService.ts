import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import type { CalendarFeedRow } from '@/lib/calendarFeed';

/**
 * The subscribable calendar feed for the signed-in person's own rota
 * (docs/SAAS.md CAP-063, `0099`).
 *
 * ## Why this is not the ICS download
 *
 * `src/lib/ics.ts` produces a file, and a file is a snapshot: import it, have
 * the rota amended, and the phone still shows last week's shifts —
 * confidently, with a reminder. `docs/PRODUCT-SPEC.md` has claimed a "calendar
 * subscription" throughout, and this is the thing that makes that true. Both
 * are kept: a download is right for "send me this week", a subscription is
 * right for "keep my calendar current".
 *
 * ## The URL is the credential
 *
 * A calendar client cannot present a header, so the token lives in the query
 * string. It reads one person's own published shifts and nothing else, and it
 * is rotatable from the same screen that shows it ("Reset link" on My rota).
 * Treat it as something worth keeping private, not as a password.
 *
 * A link no calendar reads for 90 days stops working (GAP-052, `0158`);
 * `calendarFeedState` in `src/lib/calendarFeed.ts` decides that from the row
 * this returns, because the database only marks it revoked on the next read.
 */

/** Null when the person has no live feed — the normal state until they ask. */
export async function getMyCalendarFeed(orgId: string): Promise<CalendarFeedRow | null> {
  const { data, error } = await supabase
    .from('calendar_feed_tokens')
    .select('token, created_at, last_used_at')
    .eq('org_id', orgId)
    .is('revoked_at', null)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Issue a feed, or rotate an existing one.
 *
 * Creating and rotating are the same call on purpose: `0099` revokes any live
 * token and issues a new one in one transaction, so somebody who has shared a
 * URL by accident fixes it with the same button they used to get it.
 */
export async function issueMyCalendarFeedToken(orgId: string): Promise<string> {
  const { data, error } = await supabase.rpc('issue_calendar_feed_token', {
    p_org: orgId,
  });
  if (error) throw error;
  return data;
}

export async function revokeMyCalendarFeedToken(orgId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_calendar_feed_token', {
    p_org: orgId,
  });
  if (error) throw error;
}

/**
 * The URL a calendar subscribes to.
 *
 * Built from `VITE_SUPABASE_URL` rather than stored, so it cannot go stale
 * against a project that moves, and so the token is the only thing the
 * database holds.
 */
export function calendarFeedUrl(token: string): string {
  return `${env.supabaseUrl}/functions/v1/calendar-feed?token=${token}`;
}
