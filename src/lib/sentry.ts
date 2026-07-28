import * as Sentry from '@sentry/react';
import { env } from '@/lib/env';

/** Initialize Sentry once at startup. No-ops if no DSN is configured. */
export function initSentry(): void {
  if (!env.sentryDsn) return;

  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.mode,
    enabled: env.isProd, // don't spam Sentry from local dev
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    tracesSampleRate: 0.2,
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 1.0,
  });
}

/** Report a handled error with optional context. */
export function reportError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!env.sentryDsn) {
    // eslint-disable-next-line no-console
    console.error(error, context);
    return;
  }
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
