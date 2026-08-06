// inngest. RotaFlow
//
// Hosts RotaFlow's Inngest functions as a Supabase Edge Function. The
// documented architecture (CLAUDE.md §4.2: "the functions endpoint is
// hosted on a Supabase Edge Function, never on cPanel"). Inngest Cloud has
// no dashboard "route event X to URL Y" webhook feature; functions are code
// you host yourself, and Inngest discovers them by syncing this endpoint
// (dashboard → Apps → sync app, pointed at this function's URL). Once
// synced, Inngest calls back into this endpoint to run a function whenever
// a matching event arrives from useInngestDispatch's write-only ingest POST
// (src/hooks/useInngestDispatch.ts).
//
// Every function here does the same thing: forward the triggering event's
// data verbatim to send-notification, which already validates its own
// shape and resolves org-specific vs global SMTP (0010_org_smtp_settings).
// Kept as a thin adapter rather than duplicating that logic here.
//
// Auth: deployed with --no-verify-jwt. Inngest's own request signing
// (via INNGEST_SIGNING_KEY) is what authenticates calls into this function
//. There is no end-user session, so Supabase's gateway-level JWT check
// would only ever reject Inngest's real requests. The outbound call to
// send-notification still goes through Supabase's normal gateway, so it
// carries SUPABASE_SERVICE_ROLE_KEY as its Authorization header.
//
// Deploy: `supabase functions deploy inngest --no-verify-jwt`.
// Secrets: `supabase secrets set INNGEST_EVENT_KEY=... INNGEST_SIGNING_KEY=...`
// (same values already in .env). NOTIFICATION_FUNCTION_SECRET must already
// be set. See send-notification's header.
//
// After deploying: Inngest dashboard → Apps → Sync new app, pointed at
// <SUPABASE_URL>/functions/v1/inngest
//
// VERIFICATION STATUS (2026-08-01, docs/audit01.md P0-3)
//
// Deployed and ACTIVE (version 1, verify_jwt: false. Correct, since Inngest
// cannot present a Supabase JWT). The thing that matters given the platform
// gate is off is verified against the live project: an unsigned POST to
// /functions/v1/inngest returns **401 {"message":"Unauthorized"}**, so the
// Inngest SDK's request-signature check is genuinely enforcing, and this
// publicly-reachable endpoint is not open. INNGEST_EVENT_KEY and
// INNGEST_SIGNING_KEY are both set on the project.
//
// STILL UNVERIFIED: a real event actually flowing client -> Inngest -> here ->
// send-notification. That needs a signed event from the Inngest side; confirm
// in the Inngest dashboard (Apps, Functions, Runs). Until then the transport is
// unproven even though the endpoint is correctly locked down.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { Inngest } from 'npm:inngest@4';
import { serve } from 'npm:inngest@4/edge';

const inngest = new Inngest({
  id: 'rotaflow',
  eventKey: Deno.env.get('INNGEST_EVENT_KEY'),
  signingKey: Deno.env.get('INNGEST_SIGNING_KEY'),
});

interface NotifyEventData {
  orgId: string;
  userIds: string[];
  type: string;
  title: string;
  body?: string;
}

/**
 * One function per event name dispatched by useInngestDispatch. All four
 * (leave/reviewed, rota/published, swap/reviewed, announcement/published)
 * already carry the exact shape send-notification expects.
 */
function notifyFn(eventName: string) {
  return inngest.createFunction(
    {
      id: `notify-${eventName.replace('/', '-')}`,
      retries: 2,
      triggers: { event: eventName },
    },
    async ({ event, step }: { event: { data: NotifyEventData }; step: { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> } }) => {
      return await step.run('call-send-notification', async () => {
        const secret = Deno.env.get('NOTIFICATION_FUNCTION_SECRET');
        if (!secret) throw new Error('NOTIFICATION_FUNCTION_SECRET is not set');

        const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-notification-secret': secret,
            Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify(event.data),
        });
        if (!res.ok) {
          throw new Error(`send-notification responded ${res.status}: ${await res.text()}`);
        }
        return await res.json();
      });
    },
  );
}

const functions = [
  notifyFn('leave/reviewed'),
  notifyFn('rota/published'),
  notifyFn('swap/reviewed'),
  notifyFn('announcement/published'),
];

Deno.serve(
  serve({
    client: inngest,
    functions,
    servePath: '/functions/v1/inngest',
  }),
);
