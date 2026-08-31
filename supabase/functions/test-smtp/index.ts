// test-smtp. RotaFlow
//
// Sends a real test email through an org's own SMTP credentials, so an owner
// configuring Integrations gets a genuine pass/fail rather than "settings
// saved" being mistaken for "settings work". On success, stamps
// org_smtp_settings.verified_at. The one place that column is ever written.
//
// Auth: the caller's JWT is forwarded (like ai-rota-assistant) so RLS proves
// org ownership via has_org_role before anything happens. That check alone
// can't read smtp_pass, though. It's excluded from the column-level SELECT
// grant on org_smtp_settings entirely (0010_org_smtp_settings.sql), by
// design, so nothing short of service_role can read the password back,
// including this function's own owner check. A second, service_role-backed
// client is used only after ownership is confirmed, and only to read/update
// this one table.
//
// Deploy: `supabase functions deploy test-smtp`.
// Secrets: none beyond SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY,
// which every Supabase project already provides to its Edge Functions.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { reportEdgeError } from '../_shared/sentry.ts';

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type';
// Set per-request at the top of the `Deno.serve` handler below. See
// ai-rota-assistant/index.ts for why this is a `let`, not a `const`.
let requestCorsHeaders: Record<string, string> = {};

interface RequestBody {
  orgId: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  requestCorsHeaders = corsHeaders(req, ALLOW_HEADERS);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: requestCorsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing Authorization header' }, 401);
    }

    const { orgId } = (await req.json()) as Partial<RequestBody>;
    if (!orgId) {
      return jsonResponse({ error: 'orgId is required' }, 400);
    }

    // Scoped as the calling user. This is the actual authorization check.
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const { data: isOwner, error: roleError } = await callerClient.rpc('has_org_role', {
      p_org: orgId,
      p_roles: ['owner'],
    });
    if (roleError) throw roleError;
    if (!isOwner) {
      return jsonResponse({ error: 'Only the organisation owner can test SMTP settings' }, 403);
    }

    const { data: profile, error: profileError } = await callerClient
      .from('profiles')
      .select('email')
      .eq('id', user.id)
      .single();
    if (profileError) throw profileError;

    // Ownership is confirmed, only now do we touch the one client that can
    // actually read smtp_pass. See the file header for why this must be two
    // separate clients rather than one.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: settings, error: settingsError } = await adminClient
      .from('org_smtp_settings')
      .select('smtp_host, smtp_port, smtp_user, smtp_pass, from_email, from_name')
      .eq('org_id', orgId)
      .maybeSingle();
    if (settingsError) throw settingsError;
    if (!settings) {
      return jsonResponse({ error: 'Save SMTP settings before testing them' }, 404);
    }

    const { default: nodemailer } = await import('npm:nodemailer@6');
    const transport = nodemailer.createTransport({
      host: settings.smtp_host,
      port: settings.smtp_port,
      // 465 is implicit TLS; every other port (587 included) starts plain
      // and upgrades via STARTTLS. Secure:true there breaks the handshake.
      secure: settings.smtp_port === 465,
      auth: { user: settings.smtp_user, pass: settings.smtp_pass },
      // A bad owner-provided host must fail fast, not hang the function.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
    });

    try {
      await transport.sendMail({
        from: settings.from_name
          ? `"${settings.from_name}" <${settings.from_email}>`
          : settings.from_email,
        to: profile.email,
        subject: 'RotaFlow. SMTP test',
        text: 'This is a test email from RotaFlow. Your organisation SMTP settings are working correctly.',
      });
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : 'Unknown SMTP error';
      return jsonResponse({ ok: false, error: message }, 200);
    }

    const { error: stampError } = await adminClient
      .from('org_smtp_settings')
      .update({ verified_at: new Date().toISOString() })
      .eq('org_id', orgId);
    if (stampError) throw stampError;

    return jsonResponse({ ok: true, sentTo: profile.email });
  } catch (error) {
    reportEdgeError(error, 'test-smtp:unhandled');
    return jsonResponse({ error: 'Unexpected error testing SMTP settings' }, 500);
  }
});
