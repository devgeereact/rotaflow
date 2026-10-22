// delete-account. RotaFlow
//
// Removes the login of a person whose erasure case was closed as completed
// (0162, GAP-057).
//
// Invoked by ONE caller: `dispatch_account_deletions()`, the pg_cron job that
// drains `account_deletions`. Never by a browser. Rows reach that queue from
// `set_gdpr_request_status`, in the same transaction as the case closing, and
// that function refuses to close the case when the deletion could not succeed
// (the last owner of an organisation, or a platform role).
//
// Why an Edge Function: `auth.users` belongs to the Auth service, and the
// Auth Admin API is the supported way to remove a user. It needs the service
// role, which only a function holds. The delete cascades as 0066 made
// possible: profile, memberships and platform grants go, `created_by` and
// `staff_profiles.user_id` become null, and audit rows keep their history.
//
// Auth: the same shared secret header as send-notification and purge-storage,
// verified in the database by `verify_notification_secret()` (0091). This
// function never sees the value.
//
// Answers 2xx only when the user is gone. A user already gone counts as gone,
// so the drain retrying after a lost response does no harm.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { reportEdgeError } from '../_shared/sentry.ts';
import { isAlreadyGone, parseDeleteAccountRequest } from './request.ts';

const ALLOW_HEADERS = 'x-notification-secret, content-type';
let requestCorsHeaders: Record<string, string> = {};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  requestCorsHeaders = corsHeaders(req, ALLOW_HEADERS);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: requestCorsHeaders });
  }
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const presented = req.headers.get('x-notification-secret');
    if (!presented) return jsonResponse({ error: 'Unauthorized' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      // service_role, deliberately: see the file header.
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: ok, error: verifyError } = await supabase.rpc(
      'verify_notification_secret',
      { p_presented: presented },
    );
    if (verifyError) {
      reportEdgeError(verifyError, 'delete-account:verify');
      return jsonResponse({ error: 'Account deletion is not configured yet' }, 503);
    }
    if (ok !== true) return jsonResponse({ error: 'Unauthorized' }, 401);

    const request = parseDeleteAccountRequest(await req.json().catch(() => null));
    if (!request) return jsonResponse({ error: 'Not a user id' }, 400);

    const { error } = await supabase.auth.admin.deleteUser(request.userId);
    if (error && !isAlreadyGone(error)) throw error;

    return jsonResponse({ deleted: true });
  } catch (err) {
    reportEdgeError(err, 'delete-account:delete');
    return jsonResponse({ error: 'Could not delete the account' }, 500);
  }
});
