// send-notification. RotaFlow
//
// Creates in-app notification rows and delivers them by push and/or email.
// Invoked by an Inngest function (per docs/ARCHITECTURE.md §6's documented
// flow: client → useInngestDispatch → Inngest → this function), never
// directly by a browser. There is no end user to hold an Authorization JWT
// for a call that writes notifications for OTHER people.
//
// notifications has no client insert policy (0002_rotaflow.sql: "inserts are
// performed by Edge Functions (service role)") specifically so a browser
// session can never write into someone else's inbox. That is also why this
// function runs as service_role rather than forwarding a caller's JWT the way
// ai-rota-assistant does. There is no caller-scoped RLS path that could ever
// satisfy this function's job.
//
// Auth: a shared secret header, not a user JWT (see above). Set
// NOTIFICATION_FUNCTION_SECRET as a Supabase secret and configure the same
// value on the Inngest function that calls this endpoint.
//
// Email: an org's own SMTP account (org_smtp_settings, 0010) is preferred
// when configured. See resolveSmtpConfig, falling back to the global
// SMTP_* secrets below, and skipped entirely if neither exists.
//
// Deploy: `supabase functions deploy send-notification`.
// Secrets: `supabase secrets set NOTIFICATION_FUNCTION_SECRET=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=...`
//   (SMTP_HOST/PORT/USER/PASS/FROM optional. Email is skipped without them,
//   unless the recipient org has configured its own SMTP)
//
// VERIFICATION STATUS (2026-08-01, `docs/SAAS.md`)
//
// Deployed and ACTIVE (version 3, verify_jwt: true). Its AUTH is verified
// against the live project. Probed, not assumed:
//   * no Authorization header        -> 401 UNAUTHORIZED_NO_AUTH_HEADER (platform gate)
//   * valid anon JWT, no secret      -> 401 {"error":"Unauthorized"}   (this function)
//   * valid anon JWT, wrong secret   -> 401 {"error":"Unauthorized"}   (this function)
// So the shared-secret guard genuinely works, and holding the public anon key
// is not enough to write into anyone's notification inbox. Every secret this
// function reads (NOTIFICATION_FUNCTION_SECRET, VAPID_*, SMTP_*) is set on the
// project.
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
// that can honour them: the dispatch sites do not know the recipients'
// preferences and the Inngest hop carries no session.
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
// RECIPIENT SCOPING (added 2026-08-10, security audit)
//
// The shared secret proves the CALLER is this project's own Inngest function,
// not that the caller was RIGHT to name these particular orgId/userIds — the
// Inngest function forwards event.data verbatim (supabase/functions/inngest),
// and VITE_INNGEST_EVENT_KEY is a public, Vite-inlined value by design. So
// this function, not that one, is the only place left to check that every
// userId is actually a member of orgId before anything is written or sent.
// This closes cross-tenant impersonation (org A's event naming org B's users)
// but NOT same-tenant abuse (a member of org A naming other members of org A
// with a fabricated type/title) — that needs the caller's own identity and
// role forwarded through the dispatch chain, a bigger change than this pass.
// Known residual limitation, not a silent claim of full closure.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { corsHeaders } from '../_shared/cors.ts';

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
    if (typeof typed[channel] === 'boolean') resolved[channel] = typed[channel] as boolean;
  }
  return resolved;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Placeholder values ship in .env.example; sending against them would just fail loudly. */
function globalSmtpIsConfigured(): boolean {
  const host = Deno.env.get('SMTP_HOST');
  const pass = Deno.env.get('SMTP_PASS');
  return Boolean(host) && host !== 'smtp.yourhost.com' && Boolean(pass) && pass !== 'your-smtp-password';
}

interface SmtpTransportConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/**
 * An org's own SMTP account (0010_org_smtp_settings.sql) if it has one
 * configured, so mail comes from their domain/mailbox rather than a shared
 * system sender. Falls back to the global SMTP_* secrets otherwise. The
 * same posture as before org-level settings existed. Reads smtp_pass via the
 * service-role client, which is the only role that ever can (see the
 * migration's file header).
 */
async function resolveSmtpConfig(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
): Promise<SmtpTransportConfig | null> {
  const { data: orgSmtp, error: orgSmtpError } = await supabase
    .from('org_smtp_settings')
    .select('smtp_host, smtp_port, smtp_user, smtp_pass, from_email, from_name')
    .eq('org_id', orgId)
    .maybeSingle();

  if (orgSmtpError) {
    // A transient lookup failure must not silently look identical to "this
    // org has no SMTP configured". That's exactly the shared-sender outcome
    // this feature exists to avoid. Never log the row itself: it carries
    // smtp_pass.
    console.error('resolveSmtpConfig: org SMTP lookup failed', orgSmtpError.message);
  }

  if (orgSmtp) {
    return {
      host: orgSmtp.smtp_host,
      port: orgSmtp.smtp_port,
      user: orgSmtp.smtp_user,
      pass: orgSmtp.smtp_pass,
      from: orgSmtp.from_name ? `"${orgSmtp.from_name}" <${orgSmtp.from_email}>` : orgSmtp.from_email,
    };
  }

  if (!globalSmtpIsConfigured()) return null;
  return {
    host: Deno.env.get('SMTP_HOST')!,
    port: Number(Deno.env.get('SMTP_PORT') ?? '587'),
    user: Deno.env.get('SMTP_USER')!,
    pass: Deno.env.get('SMTP_PASS')!,
    from: Deno.env.get('SMTP_FROM')!,
  };
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
    const expectedSecret = Deno.env.get('NOTIFICATION_FUNCTION_SECRET');
    if (!expectedSecret) {
      return jsonResponse({ error: 'Notification delivery is not configured yet' }, 503);
    }
    if (req.headers.get('x-notification-secret') !== expectedSecret) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const body = (await req.json()) as Partial<RequestBody>;
    const { orgId, userIds, type, title } = body;
    if (!orgId || !userIds?.length || !type || !title) {
      return jsonResponse({ error: 'orgId, userIds, type and title are required' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      // service_role. Deliberate, see the file header. Never forward this
      // key or a caller's JWT beyond this function.
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

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
      return jsonResponse({ ok: true, results: { push: null, email: null }, dropped: userIds.length });
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
          channel: 'push',
        })),
      );
      if (insertError) throw insertError;
    }

    const results = { push: { sent: 0, expired: 0, failed: 0 }, email: { sent: 0, skipped: 0, failed: 0 } };

    if (channels.includes('push')) {
      const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
      const vapidPublicKey = Deno.env.get('VITE_VAPID_PUBLIC_KEY');
      const vapidSubject = Deno.env.get('VAPID_SUBJECT');

      if (vapidPrivateKey && vapidPublicKey && vapidSubject) {
        webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

        const { data: subscriptions } = await supabase
          .from('push_subscriptions')
          .select('id, endpoint, p256dh, auth_key')
          .in('user_id', reachableUserIds);

        const expiredIds: string[] = [];
        for (const sub of subscriptions ?? []) {
          const outcome = await sendPush(sub, { title, body: body.body });
          results.push[outcome]++;
          if (outcome === 'expired') expiredIds.push(sub.id);
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
      } else {
        const { default: nodemailer } = await import('npm:nodemailer@6');
        const transport = nodemailer.createTransport({
          host: smtpConfig.host,
          port: smtpConfig.port,
          // 465 is implicit TLS; every other port (587 included) starts plain
          // and upgrades via STARTTLS. Secure:true there breaks the handshake.
          secure: smtpConfig.port === 465,
          auth: { user: smtpConfig.user, pass: smtpConfig.pass },
          // A bad owner-provided host must fail fast, not hang the function.
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
        });

        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, email')
          .in('id', reachableUserIds);

        for (const profile of profiles ?? []) {
          try {
            await transport.sendMail({
              from: smtpConfig.from,
              to: profile.email,
              subject: title,
              text: body.body ?? title,
            });
            results.email.sent++;
          } catch {
            results.email.failed++;
          }
        }
      }
    }

    return jsonResponse({ ok: true, results, dropped: droppedCount });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
