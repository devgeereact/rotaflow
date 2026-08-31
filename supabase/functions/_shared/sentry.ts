/**
 * Error reporting for Edge Functions (docs/SAAS.md HARDEN-005).
 *
 * ## Why this exists
 *
 * There are 23 `console.error` calls across the seven functions and
 * nothing reads them. The browser has had Sentry since the beginning, so
 * a React error is triaged within minutes while a Stripe webhook that
 * throws — the one place money and subscription state change — is a line
 * in a log nobody opens. The asymmetry is backwards: the server-side
 * failures are the ones nobody can see happening.
 *
 * ## Why not the Sentry SDK
 *
 * `@sentry/deno` pulls a large dependency into every function for one
 * POST. Sentry's envelope endpoint is a documented HTTP API and this is
 * about thirty lines against it. Fewer moving parts in a runtime where a
 * bad import is a 500 on a live endpoint.
 *
 * ## Rules this follows
 *
 * 1. **It never throws.** A failing error-reporter that breaks the
 *    request it was reporting on turns an incident into an outage. Every
 *    path here is wrapped, and failure is one `console.error` — the thing
 *    that was happening anyway.
 * 2. **It never blocks the response.** The POST is fire-and-forget;
 *    Deno's runtime keeps it alive past the handler returning.
 * 3. **It no-ops without a DSN**, quietly, because that is the correct
 *    behaviour for a local `supabase functions serve` and for any fork.
 * 4. **It carries no user content.** The message and the context keys
 *    are ours; nothing from a request body is attached. A rota is
 *    somebody's staffing, and an error tracker is not where it belongs.
 *
 * Set with: `supabase secrets set SENTRY_DSN=...`
 */

interface ParsedDsn {
  url: string;
  key: string;
}

/**
 * `https://<key>@<host>/<project>` becomes the envelope endpoint for that
 * project. Returns null rather than throwing on a malformed DSN: a typo in
 * a secret must not take down every function that imports this.
 */
function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const parsed = new URL(dsn);
    const projectId = parsed.pathname.replace(/^\//, '');
    if (!parsed.username || !projectId) return null;
    return {
      url: `${parsed.protocol}//${parsed.host}/api/${projectId}/envelope/`,
      key: parsed.username,
    };
  } catch {
    return null;
  }
}

/**
 * Report an error to Sentry, if a DSN is configured.
 *
 * `where` names the function and the step — `stripe-webhook:signature`,
 * `send-notification:smtp` — because "an error in an Edge Function" is not
 * a triageable fact. `context` takes small, non-personal scalars: an
 * event type, a status code, a count.
 */
export function reportEdgeError(
  error: unknown,
  where: string,
  context: Record<string, string | number | boolean> = {},
): void {
  // Logged unconditionally. Sentry is where these get noticed; the log is
  // still where somebody looks once they are already in the dashboard.
  console.error(`[${where}]`, error, context);

  try {
    const dsn = Deno.env.get('SENTRY_DSN');
    if (!dsn) return;
    const parsed = parseDsn(dsn);
    if (!parsed) {
      console.error('[sentry] SENTRY_DSN is set but could not be parsed');
      return;
    }

    const err = error instanceof Error ? error : new Error(String(error));
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const sentAt = new Date().toISOString();

    const event = {
      event_id: eventId,
      timestamp: sentAt,
      platform: 'javascript',
      level: 'error',
      logger: where,
      release: Deno.env.get('SENTRY_RELEASE') ?? undefined,
      environment: Deno.env.get('SENTRY_ENVIRONMENT') ?? 'production',
      server_name: where.split(':')[0],
      tags: { runtime: 'edge', where },
      extra: context,
      exception: {
        values: [
          {
            type: err.name,
            value: err.message,
            stacktrace: err.stack ? { frames: framesFrom(err.stack) } : undefined,
          },
        ],
      },
    };

    const envelope =
      JSON.stringify({ event_id: eventId, sent_at: sentAt }) +
      '\n' +
      JSON.stringify({ type: 'event' }) +
      '\n' +
      JSON.stringify(event) +
      '\n';

    // Deliberately not awaited: an error report must not add latency to the
    // response, and must not fail the request if Sentry is unreachable.
    void fetch(parsed.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${parsed.key}, sentry_client=rotaflow-edge/1.0`,
      },
      body: envelope,
    }).catch((sendError) => {
      console.error('[sentry] could not report', sendError);
    });
  } catch (reportingError) {
    // The reporter itself broke. Say so and carry on; the caller is already
    // handling a failure and does not need a second one.
    console.error('[sentry] reporter failed', reportingError);
  }
}

/**
 * A stack string into Sentry frames, innermost last (Sentry renders the
 * last frame as the crash site).
 *
 * Best-effort by design: an unparseable stack yields no frames rather than
 * an exception, and the message alone is still worth having.
 */
function framesFrom(stack: string): { filename: string; function: string }[] {
  return stack
    .split('\n')
    .slice(1, 21)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .map((line) => {
      const match = /^at\s+(.+?)\s+\((.+)\)$/.exec(line);
      return match
        ? { function: match[1] ?? '?', filename: match[2] ?? '?' }
        : { function: '?', filename: line.replace(/^at\s+/, '') };
    })
    .reverse();
}
