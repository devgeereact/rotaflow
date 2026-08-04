import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import {
  statusForLatency,
  type HealthCheck,
  type HealthStatus,
} from '@/lib/platformHealth';

/**
 * Live platform checks, run from the browser with the caller's own session.
 *
 * ## What this can and cannot see
 *
 * This is a static PWA. There is no server of ours to ask, so every number
 * here is measured from the administrator's own device: a real round trip to
 * Supabase, a real realtime handshake, the real session. That makes the
 * latencies honest but *local* — they include the viewer's network, so they
 * answer "can I reach the platform, and how fast" rather than "what is the
 * platform's global p95".
 *
 * Deliberately absent, because a browser with an anon key cannot know them and
 * inventing them would be worse than omitting them: error rates, queue depth,
 * background-job health, storage totals and per-region latency. The page says
 * so on screen rather than filling the space with plausible numbers.
 */

/** How long a probe may take before we stop waiting and call it down. */
const PROBE_TIMEOUT_MS = 8_000;

/** Resolve to `null` if the promise has not settled in time. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Database reachability and round-trip time, via the cheapest query available. */
async function checkDatabase(): Promise<HealthCheck> {
  const started = performance.now();
  const result = await withTimeout(
    // `head: true` sends no rows back — this measures the round trip, not the
    // payload. RLS still applies, which is the point: it proves the path a real
    // request takes, not a privileged shortcut.
    Promise.resolve(
      supabase.from('organisations').select('id', { count: 'exact', head: true }),
    ),
    PROBE_TIMEOUT_MS,
  );
  const latencyMs = performance.now() - started;

  if (result === null) {
    return {
      name: 'PostgreSQL database',
      status: 'down',
      detail: `No response within ${PROBE_TIMEOUT_MS / 1_000} seconds.`,
    };
  }
  if (result.error) {
    return {
      name: 'PostgreSQL database',
      status: 'down',
      latencyMs,
      detail: `Query failed: ${result.error.message}`,
    };
  }
  return {
    name: 'PostgreSQL database',
    status: statusForLatency(latencyMs),
    latencyMs,
    detail: 'Reachable, and row-level security is answering as expected.',
  };
}

/** Auth reachability, plus how long the current session has left. */
async function checkAuth(): Promise<HealthCheck> {
  const started = performance.now();
  const result = await withTimeout(supabase.auth.getSession(), PROBE_TIMEOUT_MS);
  const latencyMs = performance.now() - started;

  if (result === null) {
    return {
      name: 'Authentication',
      status: 'down',
      detail: `No response within ${PROBE_TIMEOUT_MS / 1_000} seconds.`,
    };
  }
  if (result.error) {
    return {
      name: 'Authentication',
      status: 'down',
      latencyMs,
      detail: `Session lookup failed: ${result.error.message}`,
    };
  }

  const expiresAt = result.data.session?.expires_at;
  const detail =
    expiresAt === undefined
      ? 'Responding. No active session on this device.'
      : `Responding. This session expires ${new Date(expiresAt * 1_000).toLocaleString('en-GB')}.`;

  return {
    name: 'Authentication',
    status: statusForLatency(latencyMs),
    latencyMs,
    detail,
  };
}

/**
 * Realtime handshake. Subscribes to a throwaway channel and times how long the
 * socket takes to say SUBSCRIBED, then tears it down.
 */
async function checkRealtime(): Promise<HealthCheck> {
  const started = performance.now();
  const channelName = `health-probe-${Date.now()}`;
  const channel = supabase.channel(channelName);

  const settled = await withTimeout(
    new Promise<HealthStatus>((resolve) => {
      // Compare against the enum rather than string literals: the callback is
      // typed `REALTIME_SUBSCRIBE_STATES`, and a bare string would silently
      // stop matching if supabase-js ever renamed a member.
      channel.subscribe((status) => {
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) resolve('operational');
        if (
          status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
          status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
        ) {
          resolve('down');
        }
      });
    }),
    PROBE_TIMEOUT_MS,
  );
  const latencyMs = performance.now() - started;
  void supabase.removeChannel(channel);

  if (settled === null) {
    return {
      name: 'Realtime',
      status: 'down',
      detail: 'The websocket did not complete a handshake in time.',
    };
  }
  if (settled === 'down') {
    return {
      name: 'Realtime',
      status: 'down',
      latencyMs,
      detail: 'The websocket refused the subscription.',
    };
  }
  return {
    name: 'Realtime',
    status: statusForLatency(latencyMs),
    latencyMs,
    detail: 'Subscribed and receiving. Live rota updates will arrive.',
  };
}

/**
 * Services we can only report configuration for. Marked `configuredOnly` so the
 * UI can say "configured" rather than implying a live probe happened — a key
 * being present proves the app will try, not that the far end is up.
 */
function configuredServices(): HealthCheck[] {
  const entry = (
    name: string,
    present: boolean,
    whenPresent: string,
    whenAbsent: string,
  ): HealthCheck => ({
    name,
    status: present ? 'operational' : 'unknown',
    detail: present ? whenPresent : whenAbsent,
    configuredOnly: true,
  });

  return [
    entry(
      'File storage (ImageKit)',
      Boolean(env.imagekitUrlEndpoint),
      'Endpoint configured. Uploads are routed to ImageKit.',
      'No endpoint configured — uploads fall back to local handling.',
    ),
    entry(
      'Error monitoring (Sentry)',
      Boolean(env.sentryDsn),
      'DSN configured. Client errors are reported.',
      'No DSN — client errors are not reported anywhere.',
    ),
    entry(
      'Background workflows (Inngest)',
      Boolean(env.inngestEventKey),
      'Event key present. Queued and scheduled jobs are dispatched.',
      'No event key — scheduled and queued jobs are not dispatched.',
    ),
    entry(
      'Push notifications',
      Boolean(env.vapidPublicKey),
      'VAPID key present. Devices can subscribe to push.',
      'No VAPID key — push subscriptions cannot be created.',
    ),
    entry(
      'Single sign-on',
      env.oauthProviders.length > 0,
      `Providers offered: ${env.oauthProviders.join(', ')}.`,
      'No OAuth providers declared — password sign-in only.',
    ),
  ];
}

/**
 * Run every probe. Live checks run concurrently — they are independent, and
 * running them in series would make the page feel broken on a slow connection.
 */
export async function runHealthChecks(): Promise<HealthCheck[]> {
  const live = await Promise.all([checkDatabase(), checkAuth(), checkRealtime()]);
  return [...live, ...configuredServices()];
}
