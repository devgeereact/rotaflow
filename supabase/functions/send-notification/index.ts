// send-notification. RotaFlow
//
// Creates in-app notification rows and delivers them by push and/or email.
// Invoked by ONE caller: `drain_notification_outbox()`, the `pg_cron` job that
// empties `notification_outbox` (`0069`, `0087`). Never directly by a browser.
// There is no end user to hold an Authorization JWT for a call that writes
// notifications for OTHER people.
//
// This header used to describe the flow "client → useInngestDispatch → Inngest
// → this function". That path was deleted by `0087`/HARDEN-008 and the hook
// with it, but the comment stayed and went on instructing whoever read it to
// configure a shared secret on an Inngest function that no longer exists.
//
// notifications has no client insert policy (0002_rotaflow.sql: "inserts are
// performed by Edge Functions (service role)") specifically so a browser
// session can never write into someone else's inbox. That is also why this
// function runs as service_role rather than forwarding a caller's JWT the way
// ai-rota-assistant does. There is no caller-scoped RLS path that could ever
// satisfy this function's job.
//
// Auth: a shared secret header, not a user JWT (see above). NOTHING TO SET.
// `0091` generates the secret inside Postgres and keeps it in `vault`; the
// drain reads it there to send, and `verify_notification_secret()` compares it
// there to check. There is no environment variable to configure and no second
// copy to keep in step — which is the point, because there used to be, the two
// disagreed, and the queue delivered nothing for a month while looking healthy.
//
// Email: an org's own SMTP account (org_smtp_settings, 0010) is preferred
// when configured. See resolveSmtpConfig, falling back to the global
// SMTP_* secrets below, and skipped entirely if neither exists.
//
// Deploy: `supabase functions deploy send-notification`.
// Secrets: `supabase secrets set VAPID_PRIVATE_KEY=... VAPID_SUBJECT=...`
//   (SMTP_HOST/PORT/USER/PASS/FROM optional. Email is skipped without them,
//   unless the recipient org has configured its own SMTP)
//
// VERIFICATION STATUS (auth probed 2026-08-01; version restated 2026-08-31)
//
// Deployed and ACTIVE at **version 26**, verify_jwt: true. Its AUTH is verified
// against the live project. Probed, not assumed:
//   * no Authorization header        -> 401 UNAUTHORIZED_NO_AUTH_HEADER (platform gate)
//   * valid anon JWT, no secret      -> 401 {"error":"Unauthorized"}   (this function)
//   * valid anon JWT, wrong secret   -> 401 {"error":"Unauthorized"}   (this function)
// So the shared-secret guard genuinely works, and holding the public anon key
// is not enough to write into anyone's notification inbox. This block said
// "version 3" for a month of deploys; a version number written by hand is a
// number that rots, so read it from the project rather than from here.
//
// STILL UNVERIFIED: **delivery**. Nobody has watched a web-push notification
// arrive on a device or an email land in a mailbox. Proving that needs an org
// owner's session and sends real messages to real people, so it is a deliberate
// manual step, not something to trigger from a dev session. Until someone does
// it, treat push/email delivery as unproven. The auth path is not the whole
// journey.
//
// One reason it could never have worked is now closed: until 2026-08-29 no
// service worker in the repo listened for `push`, so every message this
// function signed and delivered was discarded by the browser with no error.
// `public/push-sw.js` handles it now. That removes a known cause, it does not
// constitute a delivery test — see docs/SAAS.md ❓-007.
//
// PREFERENCES (added 2026-08-29, BUG-048)
//
// Two preference controls have existed in the UI since the settings screens
// shipped, and until now NEITHER reached this function:
//
//   * the organisation's matrix, 5 events x 3 channels, stored in
//     `organisations.settings.notification_defaults` and edited at
//     /app/settings/notifications;
//   * each person's own switch, `app_settings.notifications_enabled`, edited
//     at /app/account/preferences.
//
// `channels` defaulted to ['push','email'] unconditionally, so a staff member
// who had switched notifications off was emailed anyway. That is a consent
// problem, not a cosmetic one — the product asked, recorded the answer, and
// then ignored it.
//
// Both are now read here, on the send path, because this is the only place
// that can honour them: the dispatch sites are database triggers, which do not
// know the recipients' preferences, and the outbox row carries no session.
//
// The two controls do different jobs, deliberately:
//
//   * The ORG matrix governs channels, including in-app. Switching its in-app
//     column off skips the `notifications` row entirely — a toggle that writes
//     the row anyway is the same class of lie this change exists to remove.
//   * The PERSON's switch suppresses only the interruptive channels, push and
//     email. Their inbox keeps filling, because the copy beside that switch
//     promises exactly that: "You will not receive any notifications. You can
//     still see everything in the app." Dropping them from the inbox too would
//     silently delete information the screen says is still there.
//
// Defaults are deliberately permissive. An absent `app_settings` row means the
// column default (`true`), never "opted out", and an absent or malformed
// settings blob reads as all-channels-on. Muting a rota publication because a
// jsonb field was the wrong shape would be a worse failure than sending it.
//
// RECIPIENT SCOPING (added 2026-08-10; residual closed 2026-08-31)
//
// The membership filter below still runs, and should: it is defence in depth,
// and it costs one query.
//
// What it used to be load-bearing for is gone. There was a client-reachable
// path into this function — the browser posted an event to Inngest with a
// public, Vite-inlined event key, and `supabase/functions/inngest` forwarded
// event.data verbatim. That closed cross-tenant impersonation but not
// same-tenant abuse: any member could name their own colleagues with a
// fabricated type and title, and be indistinguishable from management.
//
// 0087 moved every dispatch into the database, so nothing legitimate used
// that path any more; HARDEN-008 deleted it. The `inngest` function is
// removed and undeployed. The only caller left is the pg_cron outbox drain,
// which sends rows written by triggers — a payload no client can author.
//
// This block also claimed "the event key no longer ships", and that half was
// wrong for two days. Deleting every reader of `VITE_INNGEST_EVENT_KEY` does
// not stop Vite inlining it: `import.meta.env` is emitted as a whole object,
// so the key sat in `dist/assets/index-*.js` on a public site until it was
// removed from `.env` and `.env.example` on 2026-08-31. Deleting a code path
// is not the same as deleting its credential, and only the built bundle can
// tell you which one you did.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { corsHeaders } from '../_shared/cors.ts';
import { reportEdgeError } from '../_shared/sentry.ts';
import { createSmtpTransport, resolveSmtpConfig } from '../_shared/smtp.ts';

const ALLOW_HEADERS = 'x-notification-secret, content-type';
// Set per-request at the top of the `Deno.serve` handler below. See
// ai-rota-assistant/index.ts for why this is a `let`, not a `const`.
let requestCorsHeaders: Record<string, string> = {};

interface RequestBody {
  orgId: string;
  userIds: string[];
  type: string;
  title: string;
  body?: string;
  /** Defaults to both. Most notifications should reach a device on whichever channel works. */
  channels?: ('push' | 'email')[];
}

/** Channel keys, matching src/lib/orgPreferences.ts's NOTIFICATION_CHANNELS. */
type ChannelKey = 'in_app' | 'email' | 'push';

/** Mirrors the check constraint on notification_deliveries.status (0067). */
type DeliveryStatus = 'sent' | 'failed' | 'skipped' | 'expired';

interface DeliveryRow {
  org_id: string;
  user_id: string;
  channel: ChannelKey;
  status: DeliveryStatus;
  event_type: string;
  detail: string | null;
}

/**
 * Dispatch `type` -> the settings-screen event key it is governed by.
 *
 * The four values on the left are what the app's dispatch sites actually send
 * (RotaBuilderPage, LeavePage, SwapsPage, AnnouncementsPage). The keys on the
 * right are `NOTIFICATION_EVENTS` in src/lib/orgPreferences.ts. `shift_reminder`
 * has a toggle but no dispatch site yet, so nothing maps to it.
 *
 * A type with no mapping is NOT silently dropped — it falls through to
 * everything-allowed below, because refusing to send something an owner never
 * had the chance to configure would be a worse failure than sending it.
 */
const EVENT_KEY_BY_TYPE: Record<string, string | undefined> = {
  rota: 'rota_published',
  leave: 'leave_updates',
  swap: 'swap_requests',
  announcement: 'announcements',
};

const ALL_CHANNELS_ON: Record<ChannelKey, boolean> = {
  in_app: true,
  email: true,
  push: true,
};

/**
 * Which channels this organisation permits for this event.
 *
 * Mirrors `notificationMatrix()` in src/lib/orgPreferences.ts, including its
 * default: anything absent or malformed reads as ON. An unreadable settings
 * blob must not silently mute a rota publication.
 */
function resolveOrgChannels(
  settings: unknown,
  eventKey: string | undefined,
): Record<ChannelKey, boolean> {
  if (!eventKey) return { ...ALL_CHANNELS_ON };
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ...ALL_CHANNELS_ON };
  }
  const defaults = (settings as Record<string, unknown>)['notification_defaults'];
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
    return { ...ALL_CHANNELS_ON };
  }
  const row = (defaults as Record<string, unknown>)[eventKey];
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { ...ALL_CHANNELS_ON };
  }
  const typed = row as Record<string, unknown>;
  const resolved = { ...ALL_CHANNELS_ON };
  for (const channel of ['in_app', 'email', 'push'] as ChannelKey[]) {
    if (typeof typed[channel] === 'boolean')
      resolved[channel] = typed[channel] as boolean;
  }
  return resolved;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sendPush(
  subscription: { endpoint: string; p256dh: string; auth_key: string },
  payload: { title: string; body?: string },
): Promise<'sent' | 'expired' | 'failed'> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
      },
      JSON.stringify(payload),
    );
    return 'sent';
  } catch (err) {
    // 404/410 = the subscription is gone (browser data cleared, device reset).
    // Distinct from a real failure so the caller can prune it.
    const status = (err as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? 'expired' : 'failed';
  }
}

Deno.serve(async (req: Request) => {
  requestCorsHeaders = corsHeaders(req, ALLOW_HEADERS);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: requestCorsHeaders });
  }

  try {
    const presented = req.headers.get('x-notification-secret');
    if (!presented) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      // service_role. Deliberate, see the file header. Never forward this
      // key or a caller's JWT beyond this function.
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ---- The shared secret, from `vault` first (0091) ------------------
    //
    // It used to come only from `Deno.env`, which meant the same value had
    // to be set twice — here, and in `vault` for the outbox drain to send —
    // and a Supabase secret cannot be read back once set. So keeping the two
    // equal required somebody to know the value and type it into two places.
    // For a month nobody did, and the queue drained nothing while looking
    // healthy.
    //
    // `vault` is now the source of truth: 0091 generates the secret inside
    // Postgres, so no human ever handles it and there is no second copy to
    // drift. The env var is still accepted, because functions do not deploy
    // on merge — a project running the old function against the new
    // migration, or the reverse, has to keep working.
    // The comparison happens IN the database. `vault` is not a
    // PostgREST-exposed schema, so it cannot be read over the API — and it
    // should not be: this function needs to know whether the caller is right,
    // not what the secret is.
    const { data: vaultOk, error: vaultError } = await supabase.rpc(
      'verify_notification_secret',
      { p_presented: presented },
    );
    if (vaultError) console.error('verify_notification_secret failed', vaultError);

    // `vault` is the ONLY source now. The `NOTIFICATION_FUNCTION_SECRET`
    // environment variable was accepted for one release, so a deployment
    // sitting between 0091 and this function could not break; that window is
    // closed (0091 applied and v20 deployed on 2026-08-31, both verified), and
    // leaving it would keep a second copy of a credential alive for nothing.
    if (vaultError) {
      // Cannot tell either way. Refusing is the only safe answer, and 503
      // rather than 401 because this is our fault, not the caller's.
      return jsonResponse({ error: 'Notification delivery is not configured yet' }, 503);
    }
    if (vaultOk !== true) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const body = (await req.json()) as Partial<RequestBody>;
    const { orgId, userIds, type, title } = body;
    if (!orgId || !userIds?.length || !type || !title) {
      return jsonResponse({ error: 'orgId, userIds, type and title are required' }, 400);
    }

    // See "RECIPIENT SCOPING" above: never trust that every userId actually
    // belongs to orgId just because the caller said so.
    const { data: members, error: membersError } = await supabase
      .from('memberships')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .in('user_id', userIds);
    if (membersError) throw membersError;

    const memberUserIds = members?.map((m) => m.user_id) ?? [];
    if (memberUserIds.length === 0) {
      return jsonResponse({
        ok: true,
        results: { push: null, email: null },
        dropped: userIds.length,
      });
    }

    // ---- Preferences. See "PREFERENCES" in the file header. ----------------
    //
    // Two controls exist in the UI and, until now, neither reached this
    // function: the organisation's per-event/per-channel matrix, and each
    // person's own on/off switch. Both were writable and read by nothing, so a
    // staff member who opted out was emailed anyway.

    const { data: org, error: orgError } = await supabase
      .from('organisations')
      .select('settings')
      .eq('id', orgId)
      .maybeSingle();
    if (orgError) throw orgError;

    const eventKey = EVENT_KEY_BY_TYPE[type];
    const orgChannels = resolveOrgChannels(org?.settings, eventKey);

    // A person who has switched notifications off gets nothing on any channel.
    // Absent row means the column default, `true` — never treat "no row" as
    // "opted out".
    const { data: appSettings, error: settingsError } = await supabase
      .from('app_settings')
      .select('user_id, notifications_enabled')
      .in('user_id', memberUserIds);
    if (settingsError) throw settingsError;

    const optedOut = new Set(
      (appSettings ?? [])
        .filter((row) => row.notifications_enabled === false)
        .map((row) => row.user_id),
    );

    // The per-user switch suppresses the INTERRUPTIVE channels only. Its own
    // copy on /app/account/preferences reads "You will not receive any
    // notifications. You can still see everything in the app." — so the in-app
    // row keeps being written and the person can catch up in their own time.
    // Dropping them from the inbox as well would silently delete information
    // the screen promises is still there.
    const scopedUserIds = memberUserIds;
    const reachableUserIds = memberUserIds.filter((id) => !optedOut.has(id));

    const droppedCount = userIds.length - memberUserIds.length;

    // The caller may narrow the channels further, but may not widen past what
    // the organisation has allowed for this event.
    const requested = body.channels ?? ['push', 'email'];
    const channels = requested.filter((c) => orgChannels[c]);

    // Delivery record (GAP-004). `results` above has always been computed and
    // then discarded, so nobody could answer "were these people actually
    // told?". Collected per recipient per channel and written once at the end,
    // rather than a round trip per send.
    const deliveries: DeliveryRow[] = [];
    const record = (
      userId: string,
      channel: ChannelKey,
      status: DeliveryStatus,
      detail?: string,
    ): void => {
      deliveries.push({
        org_id: orgId,
        user_id: userId,
        channel,
        status,
        event_type: type,
        detail: detail ?? null,
      });
    };

    // Anyone the org matrix or their own switch removed. Recorded as
    // 'skipped' with the reason, because "nothing was sent and that was
    // correct" is a different fact from "nothing was sent".
    for (const userId of scopedUserIds) {
      if (optedOut.has(userId)) {
        record(userId, 'email', 'skipped', 'recipient opted out');
        record(userId, 'push', 'skipped', 'recipient opted out');
      }
    }
    for (const channel of ['email', 'push'] as ChannelKey[]) {
      if (!orgChannels[channel]) {
        for (const userId of reachableUserIds) {
          record(
            userId,
            channel,
            'skipped',
            'channel disabled for this event by the organisation',
          );
        }
      }
    }

    // Row per recipient. Read_at and delivery are per-person, so the row has
    // to be too; a single shared row could not track who has seen it.
    // Skipped entirely when the org has switched the in-app channel off for
    // this event — that toggle has to mean something or it should not exist.
    if (orgChannels.in_app) {
      const { error: insertError } = await supabase.from('notifications').insert(
        scopedUserIds.map((userId) => ({
          org_id: orgId,
          user_id: userId,
          type,
          title,
          body: body.body ?? null,
          // `in_app`, not `push` (BUG-049). This row IS the in-app
          // notification — it exists only inside `if (orgChannels.in_app)`
          // above — and calling it a push made the column a constant that
          // recorded nothing. How a notification fared on push or email is in
          // `notification_deliveries`, written by `record()` below; that is
          // the delivery log, this is the inbox. 0082 widened the CHECK,
          // which until now had no value this row could honestly take.
          channel: 'in_app',
        })),
      );
      if (insertError) throw insertError;
      for (const userId of scopedUserIds) record(userId, 'in_app', 'sent');
    } else {
      for (const userId of scopedUserIds) {
        record(
          userId,
          'in_app',
          'skipped',
          'in-app disabled for this event by the organisation',
        );
      }
    }

    const results = {
      push: { sent: 0, expired: 0, failed: 0 },
      email: { sent: 0, skipped: 0, failed: 0 },
    };

    if (channels.includes('push')) {
      const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
      const vapidPublicKey = Deno.env.get('VITE_VAPID_PUBLIC_KEY');
      const vapidSubject = Deno.env.get('VAPID_SUBJECT');

      if (!vapidPrivateKey || !vapidPublicKey || !vapidSubject) {
        for (const userId of reachableUserIds) {
          record(
            userId,
            'push',
            'skipped',
            'VAPID keys not configured on this deployment',
          );
        }
      }
      if (vapidPrivateKey && vapidPublicKey && vapidSubject) {
        webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

        const { data: subscriptions } = await supabase
          .from('push_subscriptions')
          // `user_id` selected so each outcome can be attributed to a person,
          // not just counted. One person may hold several subscriptions.
          .select('id, user_id, endpoint, p256dh, auth_key')
          .in('user_id', reachableUserIds);

        const expiredIds: string[] = [];
        const pushed = new Set<string>();
        for (const sub of subscriptions ?? []) {
          const outcome = await sendPush(sub, { title, body: body.body });
          results.push[outcome]++;
          pushed.add(sub.user_id);
          record(sub.user_id, 'push', outcome === 'sent' ? 'sent' : outcome);
          if (outcome === 'expired') expiredIds.push(sub.id);
        }
        // Someone with no subscription at all is not a failure — they have
        // simply never enabled push on a device — but it is the difference
        // between "we tried" and "there was nothing to try".
        for (const userId of reachableUserIds) {
          if (!pushed.has(userId)) {
            record(userId, 'push', 'skipped', 'no push subscription on any device');
          }
        }
        // Prune dead subscriptions so future sends don't keep retrying them.
        if (expiredIds.length > 0) {
          await supabase.from('push_subscriptions').delete().in('id', expiredIds);
        }
      }
    }

    if (channels.includes('email')) {
      const smtpConfig = await resolveSmtpConfig(supabase, orgId);
      if (!smtpConfig) {
        // Matches the SMS posture elsewhere in this project: the channel is
        // reserved in the schema, but not live until real credentials exist
        //. Either the org's own, or the global fallback.
        results.email.skipped = reachableUserIds.length;
        for (const userId of reachableUserIds) {
          record(
            userId,
            'email',
            'skipped',
            'no SMTP configured for this organisation or platform',
          );
        }
      } else {
        const transport = await createSmtpTransport(smtpConfig);

        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .in('id', reachableUserIds);

        // CAP-033. The organisation's own wording, falling back to the
        // platform default. A NULL result means no template at all, and the
        // send below keeps the subject-equals-title behaviour this function
        // has always had — the notification path was silently dead for a
        // month (0091), and nicer wording is not worth a change that could
        // fail closed.
        const { data: orgRow } = await supabase
          .from('organisations')
          .select('name')
          .eq('id', orgId)
          .maybeSingle();

        for (const profile of profiles ?? []) {
          let subject = title;
          let text = body.body ?? title;

          try {
            const { data: rendered } = await supabase.rpc('render_notification', {
              p_org: orgId,
              p_key: type,
              p_channel: 'email',
              p_vars: {
                org_name: orgRow?.name ?? 'RotaFlow',
                staff_name: profile.full_name ?? 'there',
                title,
                body: body.body ?? '',
                // A blank line before the detail, or nothing at all. Doing
                // this in the template would need a conditional, and a
                // template language is an injection surface for the sake of
                // formatting.
                body_line: body.body ? `\n\n${body.body}` : '',
                app_url: Deno.env.get('APP_URL') ?? 'https://rotaflow.space',
              },
            });
            const row = (rendered ?? [])[0];
            if (row?.subject) {
              subject = row.subject;
              text = row.body;
            }
          } catch (_templateError) {
            // Deliberately swallowed. A template lookup failing must never
            // stop a notification going out; the untemplated version above
            // is exactly what this function sent yesterday.
          }

          try {
            await transport.sendMail({
              from: smtpConfig.from,
              to: profile.email,
              subject,
              text,
            });
            results.email.sent++;
            record(profile.id, 'email', 'sent');
          } catch (mailError) {
            results.email.failed++;
            // The SMTP error is the whole diagnostic value of this row — a
            // bounce, a bad credential, a refused relay all look identical
            // without it. `resolveSmtpConfig` never logs the row it read, so
            // the password cannot reach here; the message is the server's.
            record(
              profile.id,
              'email',
              'failed',
              mailError instanceof Error
                ? mailError.message.slice(0, 500)
                : 'unknown error',
            );
          }
        }
      }
    }

    // Written last, in one insert, and deliberately non-fatal: a delivery
    // record that fails to save must not turn a successful send into a 500 and
    // have Inngest retry it, which would send everything twice. The send is
    // the product; this is the audit of it.
    if (deliveries.length > 0) {
      const { error: deliveryError } = await supabase
        .from('notification_deliveries')
        .insert(deliveries);
      if (deliveryError) {
        // The notification may well have been delivered; what failed is the
        // record of it. Worth reporting: this table is the evidence for
        // "were they told?".
        reportEdgeError(deliveryError, 'send-notification:delivery-log');
      }
    }

    return jsonResponse({
      ok: true,
      results,
      dropped: droppedCount,
      recorded: deliveries.length,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      500,
    );
  }
});
