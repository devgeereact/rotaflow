// calendar-feed. RotaFlow
//
// Serves one staff member's published shifts as a subscribable ICS feed
// (docs/SAAS.md CAP-063).
//
// WHY THIS EXISTS RATHER THAN THE EXISTING DOWNLOAD. `src/lib/ics.ts`
// produces a file, and a file is a snapshot: import it, have the rota
// amended, and the phone still shows last week's shifts — confidently, with
// a reminder. `docs/PRODUCT-SPEC.md` has claimed a "calendar subscription" throughout;
// this is the thing that makes that true. A calendar client re-reads this URL
// on its own schedule, so an amendment reaches the phone without anybody
// doing anything.
//
// AUTH: a token in the query string, and nothing else. That is not laziness —
// a calendar client cannot present a bearer header, hold a session, or
// refresh anything. It fetches a URL. So the URL is the credential, and the
// design assumes it will leak (a screenshot, a shared family calendar, a
// support ticket) and limits what it is worth: one person's own shifts, no
// team data, no organisation data, revocable and rotatable per person from
// their own account screen.
//
// Deployed with --no-verify-jwt for the same reason. Supabase's gateway JWT
// check would reject every real calendar client, which presents no JWT at
// all. The token check in `calendar_feed_shifts` is the actual boundary, and
// that function is granted to `service_role` alone.
//
// BOUNDS (GAP-052, `0158`). A token no calendar has read for 90 days stops
// working, and more than 120 reads an hour for one person are refused with
// 429. Both are decided in `calendar_feed_shifts`; this function only turns
// the refusal into a status code.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not say whether an unknown token
// is wrong or revoked — both return an empty calendar rather than a 404,
// because a calendar client shows an error for a 404 and nothing useful for
// a 401, and neither tells the person anything they can act on. An empty
// calendar that stops updating is the honest signal that a feed was revoked.
//
// Deploy: `supabase functions deploy calendar-feed --no-verify-jwt`.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { reportEdgeError } from '../_shared/sentry.ts';
import {
  buildCalendar,
  isRateLimited,
  RETRY_AFTER_SECONDS,
  type FeedShift,
} from './calendar.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  try {
    const token = new URL(req.url).searchParams.get('token') ?? '';

    // Shape-checked before it reaches the database. A malformed token is a
    // 22P02 from Postgres otherwise, which is a 500 in a calendar client's
    // eyes and an error log entry for something that is just a bad URL.
    if (!UUID.test(token)) {
      return new Response(buildCalendar([]), {
        headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      // service_role, and it never leaves this function. The row-level
      // decision is made by `calendar_feed_shifts`, which is granted to this
      // role alone and takes the token as its only argument — so this
      // function cannot read anything the token does not entitle it to,
      // even by mistake.
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data, error } = await supabase.rpc('calendar_feed_shifts', {
      p_token: token,
    });
    // Over the hourly allowance (`0158`). A 429 rather than the empty
    // calendar below: a real subscription never gets near the limit, so the
    // only client that sees this is one reading in a loop, and it should be
    // told to stop rather than handed a calendar that looks like a revoked
    // feed.
    if (isRateLimited(error)) {
      return new Response('Too many requests for this calendar feed.\n', {
        status: 429,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Retry-After': String(RETRY_AFTER_SECONDS),
        },
      });
    }
    if (error) throw error;

    return new Response(buildCalendar((data ?? []) as FeedShift[]), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="rotaflow.ics"',
        // Short, because the point is that an amendment arrives. Long enough
        // that a client polling every few minutes is not hitting the database
        // every time.
        'Cache-Control': 'private, max-age=900',
      },
    });
  } catch (err) {
    reportEdgeError(err, 'calendar-feed:unhandled');
    // An empty calendar, not a 500. A client that gets an error tends to
    // disable the subscription; one that gets an empty calendar retries, and
    // the shifts reappear when the fault clears.
    return new Response(buildCalendar([]), {
      status: 200,
      headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
    });
  }
});
