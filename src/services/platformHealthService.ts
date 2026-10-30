import { API_BASE_URL, api } from '@/lib/api';
import { env } from '@/lib/env';
import { statusForLatency, type HealthCheck } from '@/lib/platformHealth';

/**
 * The console's health page: live probes of the API from this browser, plus which optional services this build
 * is configured for. Realtime is polling now (useRealtimeRefresh), so there is no socket to probe. Uptime over
 * time is watched by an external monitor, not stored here.
 */

const PROBE_TIMEOUT_MS = 8_000;

async function timed<T>(
  run: () => Promise<T>,
): Promise<{ value: T | null; error: unknown; ms: number }> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS);
      }),
    ]);
    return { value, error: null, ms: performance.now() - started };
  } catch (error) {
    return { value: null, error, ms: performance.now() - started };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function checkApi(): Promise<HealthCheck> {
  const r = await timed(async () => {
    const res = await fetch(`${API_BASE_URL}/health`, { credentials: 'omit' });
    return res.ok;
  });
  if (r.value === true) {
    return {
      name: 'API and database',
      status: statusForLatency(r.ms),
      latencyMs: r.ms,
      detail: 'The API answered its health check.',
    };
  }
  return {
    name: 'API and database',
    status: 'down',
    latencyMs: r.error ? r.ms : undefined,
    detail:
      r.error || r.value === false
        ? 'The health check failed.'
        : `No response within ${PROBE_TIMEOUT_MS / 1_000} seconds.`,
  };
}

async function checkAuth(): Promise<HealthCheck> {
  const r = await timed(() => api.get<{ user: { id: string } }>('/me'));
  if (r.value) {
    return {
      name: 'Sign-in (Clerk) and API session',
      status: statusForLatency(r.ms),
      latencyMs: r.ms,
      detail: 'This session token was accepted by the API.',
    };
  }
  return {
    name: 'Sign-in (Clerk) and API session',
    status: 'down',
    detail:
      r.error instanceof Error
        ? `The API refused this session: ${r.error.message}`
        : 'No answer in time.',
  };
}

function configuredServices(): HealthCheck[] {
  const entry = (
    name: string,
    present: boolean,
    yes: string,
    no: string,
  ): HealthCheck => ({
    name,
    status: present ? 'operational' : 'unknown',
    detail: present ? yes : no,
    configuredOnly: true,
  });
  return [
    entry(
      'Error monitoring (Sentry)',
      Boolean(env.sentryDsn),
      'DSN configured. Client errors are reported.',
      'No DSN. Client errors are not reported anywhere.',
    ),
    entry(
      'Push notifications',
      Boolean(env.vapidPublicKey),
      'VAPID key present. Devices can subscribe to push.',
      'No VAPID key. Push subscriptions cannot be created.',
    ),
    entry(
      'Sign-in (Clerk)',
      Boolean(env.clerkPublishableKey),
      'Publishable key present. People sign in with an email code.',
      'No publishable key. Nobody can sign in to this build.',
    ),
  ];
}

export async function runHealthChecks(): Promise<HealthCheck[]> {
  const live = await Promise.all([checkApi(), checkAuth()]);
  return [...live, ...configuredServices()];
}
