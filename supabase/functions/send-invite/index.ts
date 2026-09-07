// send-invite. RotaFlow
//
// Emails a join link to someone an owner or manager has just invited.
//
// ## Why this exists (docs/SAAS.md GAP-005)
//
// `create_invite` (0006) mints a token and returns it, and nothing sent it
// anywhere. `TeamInviteManager` displayed the link for the manager to copy and
// pass on by hand — through WhatsApp, or a personal email, or read out loud.
// That is a silent hole in the onboarding funnel: the product's own flow
// stopped halfway and left the last step to a human who might not take it.
//
// ## Why the token is a parameter, and why that is safe
//
// `invites` stores only `token_hash`, a sha256 of the raw token, and the raw
// token exists exactly once — in `create_invite`'s return value. There is no
// way to recover it later, by design, so an email can only be sent at the
// moment of creation, by whoever just created it. A "resend" is therefore a new
// invite, not a second copy of the old one.
//
// The caller supplies the token; it does NOT supply the destination. The
// address and role are read from the invite row, and the token is verified by
// hashing it and comparing to that row's `token_hash`. So:
//
//   * a caller cannot redirect an invite to an address of their choosing;
//   * a caller cannot email a token that does not open a live invite;
//   * a caller can only touch invites their own RLS already lets them see,
//     because the lookup runs under their JWT, not service_role.
//
// The one thing this does need service_role for is `org_smtp_settings.smtp_pass`
// — the column deliberately withheld from `authenticated` entirely (0010). That
// client is used for the mail credentials and nothing else.
//
// Deploy: `supabase functions deploy send-invite`.
// Secrets: shares SMTP_* with send-notification via _shared/smtp.ts. Falls back
// to the platform mailbox when the org has none, and refuses when neither
// exists rather than reporting a send that did not happen.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { reportEdgeError } from '../_shared/sentry.ts';
import { createSmtpTransport, resolveSmtpConfig } from '../_shared/smtp.ts';

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type';
let requestCorsHeaders: Record<string, string> = {};

interface RequestBody {
  orgId: string;
  inviteId: string;
  token: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' },
  });
}

/** sha256 hex, matching `encode(digest(token,'sha256'),'hex')` in 0006. */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'an owner',
  manager: 'a manager',
  staff: 'a team member',
};

Deno.serve(async (req: Request) => {
  requestCorsHeaders = corsHeaders(req, ALLOW_HEADERS);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: requestCorsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing Authorization header' }, 401);
    }

    const { orgId, inviteId, token } = (await req.json()) as Partial<RequestBody>;
    if (!orgId || !inviteId || !token) {
      return jsonResponse({ error: 'orgId, inviteId and token are required' }, 400);
    }

    // The caller's own JWT, so `invites_select` (owner/manager only) decides
    // what they can see. A manager of another org gets nothing back.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);

    const { data: invite, error: inviteError } = await supabase
      .from('invites')
      .select('id, org_id, email, role, token_hash, expires_at, accepted_at, revoked_at')
      .eq('id', inviteId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (inviteError) throw inviteError;

    // Indistinguishable from "you may not see this org's invites", on purpose.
    if (!invite) return jsonResponse({ error: 'Invite not found' }, 404);

    if (invite.accepted_at || invite.revoked_at) {
      return jsonResponse({ error: 'That invite is no longer live' }, 409);
    }
    if (new Date(invite.expires_at as string) <= new Date()) {
      return jsonResponse({ error: 'That invite has expired' }, 409);
    }

    // Proves the caller holds the real token, so a mistyped or stale one is
    // refused rather than emailed as a link that will not work.
    if ((await sha256Hex(token)) !== invite.token_hash) {
      return jsonResponse({ error: 'That token does not match this invite' }, 400);
    }

    // service_role, and only for the mail credentials. See the file header.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const smtpConfig = await resolveSmtpConfig(admin, orgId);
    if (!smtpConfig) {
      // 503, not a silent success. The manager needs to know the link did not
      // go anywhere so they can still pass it on themselves.
      return jsonResponse(
        {
          error:
            'No mailbox is configured for this organisation or platform, so the invite could not be emailed. Share the link yourself, or set up SMTP under Settings → Integrations.',
          sent: false,
        },
        503,
      );
    }

    const { data: org } = await admin
      .from('organisations')
      .select('name')
      .eq('id', orgId)
      .maybeSingle();
    const orgName = (org?.name as string | undefined) ?? 'your organisation';

    const origin =
      req.headers.get('Origin') || Deno.env.get('APP_URL') || 'https://rotaflow.space';
    const link = `${origin}/invite/${token}`;
    const expires = new Date(invite.expires_at as string).toUTCString();
    const roleLabel = ROLE_LABEL[invite.role as string] ?? 'a team member';

    const transport = await createSmtpTransport(smtpConfig);
    try {
      await transport.sendMail({
        from: smtpConfig.from,
        // From the row, never from the request body.
        to: invite.email as string,
        subject: `You have been invited to join ${orgName} on RotaFlow`,
        text: [
          `You have been invited to join ${orgName} on RotaFlow as ${roleLabel}.`,
          '',
          'Open this link to accept:',
          link,
          '',
          `The link expires on ${expires}.`,
          '',
          'If you were not expecting this, you can ignore this email — nothing happens until you open the link.',
        ].join('\n'),
      });
    } catch (mailError) {
      // Never surface the SMTP error verbatim: an owner-supplied server can put
      // anything in it. The precise reason goes to the function log.
      // An invite that is created and never delivered looks like a working
      // invite to whoever sent it, so this one is reported rather than logged.
      reportEdgeError(mailError, 'send-invite:smtp');
      return jsonResponse(
        {
          error: 'The invite could not be emailed. Share the link yourself.',
          sent: false,
        },
        502,
      );
    }

    return jsonResponse({ sent: true, email: invite.email });
  } catch (err) {
    reportEdgeError(err, 'send-invite:unhandled');
    return jsonResponse({ error: 'Unexpected error sending the invite' }, 500);
  }
});
