// purge-storage. RotaFlow
//
// Removes a staff document, or a whole person's or organisation's folder of
// them, from the private `staff-documents` bucket (0159, decision D4).
//
// Invoked by ONE caller: `dispatch_storage_deletions()`, the pg_cron job that
// drains `storage_deletions`. Never by a browser. Rows reach that queue from
// triggers on `documents`, `staff_profiles` and `organisations`, in the same
// transaction as the delete that orphaned the file, so an erasure or an
// organisation deletion cannot finish without the file being owed.
//
// Why this exists at all: Postgres cannot remove a Storage object in a
// supported way. Deleting the `storage.objects` row leaves the bytes behind,
// and the hosted platform refuses that delete outright. Only the Storage API
// removes the file, and only the service role may remove files that nobody
// is signed in to own any more.
//
// Auth: the same shared secret header as send-notification, verified in the
// database by `verify_notification_secret()` (0091). It is the outbox drains'
// secret, generated inside Postgres and kept in `vault`; there is nothing to
// set and no second copy. This function never sees the value.
//
// Answers 2xx only when what was asked for is gone. A missing object counts
// as gone, so the drain retrying after a lost response does no harm. The
// request itself is validated by `parsePurgeRequest` (request.ts, tested
// under vitest): with the service-role key, a request that named the wrong
// path could delete anybody's file, so anything that is not an organisation
// folder, a person folder or an object inside one is refused.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { reportEdgeError } from '../_shared/sentry.ts';
import { parsePurgeRequest, PURGE_BUCKET, splitListing } from './request.ts';

const ALLOW_HEADERS = 'x-notification-secret, content-type';
let requestCorsHeaders: Record<string, string> = {};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...requestCorsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Every object under a folder, two levels deep at most (org, then person). */
async function listFolder(supabase: SupabaseClient, folder: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [folder];
  while (pending.length > 0) {
    const prefix = pending.pop()!;
    // 1000 per page; a person's documents never come close, and an
    // organisation's folder level holds people, not files.
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.storage
        .from(PURGE_BUCKET)
        .list(prefix, { limit: 1000, offset });
      if (error) throw error;
      const { objects, folders } = splitListing(prefix, data ?? []);
      found.push(...objects);
      pending.push(...folders);
      if ((data ?? []).length < 1000) break;
    }
  }
  return found;
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
    );

    const { data: ok, error: verifyError } = await supabase.rpc(
      'verify_notification_secret',
      {
        p_presented: presented,
      },
    );
    if (verifyError) {
      reportEdgeError(verifyError, 'purge-storage:verify');
      return jsonResponse({ error: 'Storage purge is not configured yet' }, 503);
    }
    if (ok !== true) return jsonResponse({ error: 'Unauthorized' }, 401);

    const request = parsePurgeRequest(await req.json().catch(() => null));
    if (!request) return jsonResponse({ error: 'Not a path this function removes' }, 400);

    const paths = request.isFolder
      ? await listFolder(supabase, request.path)
      : [request.path];

    // `remove` takes at most 1000 paths, and treats a missing one as success.
    for (let i = 0; i < paths.length; i += 1000) {
      const { error } = await supabase.storage
        .from(PURGE_BUCKET)
        .remove(paths.slice(i, i + 1000));
      if (error) throw error;
    }

    return jsonResponse({ removed: paths.length });
  } catch (err) {
    reportEdgeError(err, 'purge-storage:remove');
    return jsonResponse({ error: 'Could not remove the file' }, 500);
  }
});
