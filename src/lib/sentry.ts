import * as Sentry from '@sentry/react';
import { env } from '@/lib/env';
import { isAllowed } from '@/lib/consent';

/**
 * Crash reporting, and the two things that used to be here with it.
 *
 * ## What was removed, and why it mattered
 *
 * This file used to add `browserTracingIntegration()` at a 20% sample and
 * `replayIntegration()` at `replaysOnErrorSampleRate: 1.0`, started from
 * `src/main.tsx` before the first render, on every route including the public
 * marketing pages. Traced URLs carry organisation and staff ids in the path,
 * and a replay is a recording of a session — masked, but a recording.
 *
 * At the same time `/legal/cookies` and `/legal/privacy` both published "no
 * analytics, no tracking, and no third-party script on this site". That was a
 * statement about the product which the product contradicted, and the fix is
 * to make the statement true rather than to soften it: neither replay nor
 * tracing is needed to be told that something crashed.
 *
 * What is left is an error report — a stack trace, the page it happened on,
 * and the breadcrumbs leading to it. That is still a transfer to a processor,
 * so it is gated on the `diagnostics` consent category and declared on
 * `/legal/trust`.
 *
 * ## Breadcrumbs are not free either
 *
 * Sentry's defaults record every `fetch` URL, and this app's fetches are
 * Supabase REST calls whose query strings carry filter *values* — an email
 * address in `?email=eq.…`, a staff id, a token. Those rode along on every
 * error. `beforeBreadcrumb` strips the query string and drops console
 * breadcrumbs entirely, since a console line can contain anything at all.
 */

/** Set once, so a consent change mid-session cannot start a second client. */
let started = false;

/**
 * Remove the query string and fragment, keeping the path.
 *
 * The path is the useful half for debugging and the query is where the values
 * are.
 */
export function stripQueryString(url: string): string {
  const cut = url.search(/[?#]/u);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Drop what should not reach a processor, and trim what may.
 *
 * Exported so it can be tested directly: an assertion about a scrubbing rule
 * is worth more than an assertion that a scrubbing rule was configured.
 */
export function scrubBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (breadcrumb.category === 'console') return null;

  const data = breadcrumb.data;
  if (data && typeof data.url === 'string') {
    return { ...breadcrumb, data: { ...data, url: stripQueryString(data.url) } };
  }
  return breadcrumb;
}

/**
 * Trim the event itself, which `beforeBreadcrumb` never sees.
 *
 * Found by watching a real envelope rather than by reading the SDK: with
 * breadcrumb scrubbing in place, a page loaded as
 * `/legal/cookies?secret=…` still arrived at Sentry with the whole query
 * string in `event.request.url`, because Sentry fills that from
 * `window.location.href` when the event is built. Breadcrumbs are the trail
 * leading to an error; this is the error's own address, and it is the one a
 * password-reset or magic-link token would ride in on.
 */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const url = event.request?.url;
  if (typeof url !== 'string') return event;
  return { ...event, request: { ...event.request, url: stripQueryString(url) } };
}

/**
 * The options the client is built from.
 *
 * Exported rather than inlined so a test can assert what is *absent* — no
 * replay integration, no `tracesSampleRate` — without needing a DSN or a
 * network. Absence is the thing worth guarding: an edit that adds either one
 * back re-breaks a published claim, and nothing else would notice.
 */
export function buildSentryOptions(): Sentry.BrowserOptions {
  return {
    dsn: env.sentryDsn,
    environment: env.mode,
    release: __SENTRY_RELEASE__,
    enabled: env.isProd, // don't spam Sentry from local dev
    // Explicit rather than defaulted: this file is the evidence behind what
    // /legal/trust tells a customer, and a default can change under us.
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

/**
 * Start Sentry, if there is a DSN and the visitor has agreed to diagnostics.
 *
 * Called at startup and again when consent is granted later, which is why it
 * guards against starting twice. Somebody who declines is never connected —
 * the cost is a crash nobody hears about, and that is the cost this consent
 * model chooses.
 */
export function initSentry(): void {
  if (started) return;
  if (!env.sentryDsn) return;
  if (!isAllowed('diagnostics')) return;

  Sentry.init(buildSentryOptions());
  started = true;
}

/**
 * Stop sending when consent is withdrawn.
 *
 * `close` flushes and then refuses further events. A closed client cannot be
 * restarted in place, so `started` stays true for the rest of this page load
 * and the next load decides again from the stored record.
 */
export function disableSentry(): void {
  if (!started) return;
  void Sentry.close(0);
}

/** Report a handled error with optional context. */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!started) {
    console.error(error, context);
    return;
  }
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
