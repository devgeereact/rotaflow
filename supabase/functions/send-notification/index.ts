// send-notification — RotaFlow
//
// Creates in-app notification rows and delivers them by push and/or email.
// Invoked by an Inngest function (per docs/ARCHITECTURE.md §6's documented
// flow: client → useInngestDispatch → Inngest → this function), never
// directly by a browser — there is no end user to hold an Authorization JWT
// for a call that writes notifications for OTHER people.
//
// notifications has no client insert policy (0002_rotaflow.sql: "inserts are
// performed by Edge Functions (service role)") specifically so a browser
// session can never write into someone else's inbox. That is also why this
// function runs as service_role rather than forwarding a caller's JWT the way
// ai-rota-assistant does — there is no caller-scoped RLS path that could ever
// satisfy this function's job.
//
// Auth: a shared secret header, not a user JWT (see above). Set
// NOTIFICATION_FUNCTION_SECRET as a Supabase secret and configure the same
// value on the Inngest function that calls this endpoint.
//
// Email: an org's own SMTP account (org_smtp_settings, 0010) is preferred
// when configured — see resolveSmtpConfig — falling back to the global
// SMTP_* secrets below, and skipped entirely if neither exists.
//
// Deploy: `supabase functions deploy send-notification`.
// Secrets: `supabase secrets set NOTIFICATION_FUNCTION_SECRET=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=...`
//   (SMTP_HOST/PORT/USER/PASS/FROM optional — email is skipped without them,
//   unless the recipient org has configured its own SMTP)
//
// NOT VERIFIED END TO END. Written and typechecked, but this session has no
// way to deploy an Edge Function or drive a real Inngest event through it —
// same constraint as every migration in this repo. Confirm real push/email
// delivery manually after deploying.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-notification-secret, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  orgId: string;
  userIds: string[];
  type: string;
  title: string;
  body?: string;
  /** Defaults to both — most notifications should reach a device on whichever channel works. */
  channels?: ('push' | 'email')[];
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
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
 * system sender. Falls back to the global SMTP_* secrets otherwise — the
 * same posture as before org-level settings existed. Reads smtp_pass via the
 * service-role client, which is the only role that ever can (see the
 * migration's file header).
 */
async function resolveSmtpConfig(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
): Promise<SmtpTransportConfig | null> {
  const { data: orgSmtp } = await supabase
    .from('org_smtp_settings')
    .select('smtp_host, smtp_port, smtp_user, smtp_pass, from_email, from_name')
    .eq('org_id', orgId)
    .maybeSingle();

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
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
    const channels = body.channels ?? ['push', 'email'];

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      // service_role — deliberate, see the file header. Never forward this
      // key or a caller's JWT beyond this function.
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Row per recipient — read_at and delivery are per-person, so the row has
    // to be too; a single shared row could not track who has seen it.
    const { error: insertError } = await supabase.from('notifications').insert(
      userIds.map((userId) => ({
        org_id: orgId,
        user_id: userId,
        type,
        title,
        body: body.body ?? null,
        channel: 'push',
      })),
    );
    if (insertError) throw insertError;

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
          .in('user_id', userIds);

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
        // — either the org's own, or the global fallback.
        results.email.skipped = userIds.length;
      } else {
        const { default: nodemailer } = await import('npm:nodemailer@6');
        const transport = nodemailer.createTransport({
          host: smtpConfig.host,
          port: smtpConfig.port,
          auth: { user: smtpConfig.user, pass: smtpConfig.pass },
        });

        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, email')
          .in('id', userIds);

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

    return jsonResponse({ ok: true, results });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
