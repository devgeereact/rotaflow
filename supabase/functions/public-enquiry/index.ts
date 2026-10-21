// public-enquiry. RotaFlow
//
// Receives one message from the public contact form at `/contact` and stores
// it in `enquiries` (0155). Plans 2026, 06 §5 and 09 F2.
//
// ## Why a function, and not an anon INSERT policy
//
// The visitor has no session. Letting `anon` insert through PostgREST would
// put an unlimited, unauthenticated write on a database that holds staff
// personal data, with nothing between a script and the table. This function
// is the thing in between, and `anon` holds no privilege on `enquiries` at
// all. In order, every request:
//
//   1. must be POST (OPTIONS answers CORS);
//   2. must come from a RotaFlow origin when it carries an `Origin` header,
//      so a foreign page cannot post visitors' browsers at it;
//   3. must be a JSON body under 16 KB;
//   4. passes `validateEnquiry` (validate.ts): lengths, email shape, enums,
//      control characters. A filled honeypot is answered exactly like a real
//      enquiry and stored nowhere;
//   5. when `TURNSTILE_SECRET_KEY` is set, carries a Cloudflare Turnstile
//      token that siteverify accepts. Unset, the check is skipped, so the
//      form works before the owner has created a widget;
//   6. is stored by `receive_enquiry`, which applies a per-address and a
//      global rate limit in the same transaction as the insert. The address
//      reaches the database only as an HMAC.
//
// The response is `201 { ok: true }` or `{ error: <code> }`. It never echoes
// anything the visitor sent.
//
// ## Notification
//
// `notification_outbox` needs an organisation and `send-notification` drops
// recipients who are not its members, so it cannot address platform staff
// about a prospect. After the row is committed this sends one short email to
// `ENQUIRY_NOTIFY_EMAIL` over the platform SMTP account, with no visitor text
// in it (see `notificationText`). It runs after the response, and a failure is
// reported to Sentry and changes nothing for the visitor: the row is the
// record, and the console inbox shows it either way.
//
// Deploy: `supabase functions deploy public-enquiry --no-verify-jwt`
// (`supabase/config.toml` also sets `verify_jwt = false` for it).
// Secrets: `ENQUIRY_IP_SALT` (recommended), `ENQUIRY_NOTIFY_EMAIL` and the
// platform `SMTP_*` (optional), `TURNSTILE_SECRET_KEY` (optional).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, isAllowedOrigin } from '../_shared/cors.ts';
import { reportEdgeError } from '../_shared/sentry.ts';
import { createSmtpTransport, platformSmtpConfig } from '../_shared/smtp.ts';
import {
  boundedUserAgent,
  clientAddress,
  notificationText,
  validateEnquiry,
  type Enquiry,
} from './validate.ts';

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type';
const MAX_BODY_BYTES = 16 * 1024;
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function json(
  body: Record<string, unknown>,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/**
 * HMAC-SHA256 of the client address, hex.
 *
 * Keyed by `ENQUIRY_IP_SALT`. Without it the service-role key is used as the
 * key material, behind a fixed label so the digest is specific to this use:
 * HMAC does not reveal its key, so this is safe, but rotating that key would
 * reset every limit, which is why the dedicated secret is recommended.
 */
async function hashAddress(address: string): Promise<string> {
  const secret =
    Deno.env.get('ENQUIRY_IP_SALT') ||
    `public-enquiry:${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(address));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Cloudflare Turnstile server-side validation, per Cloudflare's documentation
 * (developers.cloudflare.com/turnstile/get-started/server-side-validation, read
 * 2026-10-12): POST `secret`, `response` and optionally `remoteip` and
 * `idempotency_key` to siteverify, and trust only `success`. A token is single
 * use and valid for 300 seconds, so a network failure here is a refusal, not a
 * pass.
 */
async function turnstileAccepts(
  secret: string,
  token: string,
  address: string,
): Promise<boolean> {
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (address !== 'unknown') form.append('remoteip', address);
  form.append('idempotency_key', crypto.randomUUID());
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return false;
    const outcome = (await res.json()) as { success?: unknown };
    return outcome.success === true;
  } catch (err) {
    reportEdgeError(err, 'public-enquiry:turnstile');
    return false;
  }
}

async function notifyPlatform(enquiry: Enquiry): Promise<void> {
  const to = Deno.env.get('ENQUIRY_NOTIFY_EMAIL');
  const smtp = platformSmtpConfig();
  if (!to || !smtp) return;
  const appUrl = Deno.env.get('APP_URL') || 'https://rotaflow.space';
  const { subject, text } = notificationText(enquiry, `${appUrl}/admin/enquiries`);
  try {
    const transport = await createSmtpTransport(smtp);
    await transport.sendMail({ from: smtp.from, to, subject, text });
  } catch (err) {
    reportEdgeError(err, 'public-enquiry:notify');
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req, ALLOW_HEADERS);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, {
      ...cors,
      Allow: 'POST, OPTIONS',
    });
  }

  const origin = req.headers.get('Origin');
  if (origin !== null && !isAllowedOrigin(origin)) {
    return json({ error: 'origin_not_allowed' }, 403, cors);
  }

  try {
    const contentType = req.headers.get('Content-Type') ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      return json({ error: 'unsupported_media_type' }, 415, cors);
    }

    const declared = Number(req.headers.get('Content-Length') ?? '0');
    if (declared > MAX_BODY_BYTES) {
      return json({ error: 'too_large' }, 413, cors);
    }
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
      return json({ error: 'too_large' }, 413, cors);
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid', fields: ['body'] }, 400, cors);
    }

    const result = validateEnquiry(body);
    if (result.kind === 'spam') {
      // Indistinguishable from success, on purpose.
      return json({ ok: true }, 201, cors);
    }
    if (result.kind === 'invalid') {
      // Field names only, never values.
      return json({ error: 'invalid', fields: result.fields }, 400, cors);
    }

    const address = clientAddress(req.headers);

    const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY');
    if (turnstileSecret) {
      if (
        !result.turnstileToken ||
        !(await turnstileAccepts(turnstileSecret, result.turnstileToken, address))
      ) {
        return json({ error: 'verification_failed' }, 400, cors);
      }
    }

    const ipHash = await hashAddress(address);
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const { enquiry } = result;
    const { error } = await admin.rpc('receive_enquiry', {
      p_name: enquiry.name,
      p_work_email: enquiry.workEmail,
      p_organisation: enquiry.organisation,
      p_team_size: enquiry.teamSize,
      p_sector: enquiry.sector,
      p_message: enquiry.message,
      p_wants_demo: enquiry.wantsDemo,
      p_marketing_consent: enquiry.marketingConsent,
      p_ip_hash: ipHash,
      p_user_agent: boundedUserAgent(req.headers.get('User-Agent')),
    });

    if (error) {
      // `consume_rate_limit` raises P0001 when a limit is reached.
      if (error.code === 'P0001') {
        return json({ error: 'rate_limited' }, 429, cors);
      }
      reportEdgeError(
        new Error(`receive_enquiry failed: ${error.code ?? 'unknown'}`),
        'public-enquiry:insert',
      );
      return json({ error: 'unavailable' }, 503, cors);
    }

    // After the response, so a slow mail server never holds up the visitor.
    // `EdgeRuntime.waitUntil` keeps the task alive past the response on the
    // hosted runtime. Read off `globalThis` because the type package does not
    // declare it, and awaited instead where it does not exist.
    const notice = notifyPlatform(enquiry);
    const runtime = (
      globalThis as { EdgeRuntime?: { waitUntil(task: Promise<unknown>): void } }
    ).EdgeRuntime;
    if (runtime) runtime.waitUntil(notice);
    else await notice;

    return json({ ok: true }, 201, cors);
  } catch (err) {
    reportEdgeError(err, 'public-enquiry:unhandled');
    return json({ error: 'unavailable' }, 500, cors);
  }
});
