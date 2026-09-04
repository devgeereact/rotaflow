import { describe, expect, it } from 'vitest';
import {
  buildSentryOptions,
  scrubBreadcrumb,
  scrubEvent,
  stripQueryString,
} from '@/lib/sentry';
import type { ErrorEvent } from '@sentry/react';

/**
 * These guard a published claim rather than a behaviour.
 *
 * `/legal/cookies` and `/legal/privacy` state that nothing on this site tracks
 * anybody. That was false while session replay and performance tracing were
 * configured here. The assertions below are about what is *absent*, because
 * absence is what nothing else in the build would notice going away.
 */
describe('buildSentryOptions', () => {
  it('configures no session replay and no performance tracing', () => {
    const options = buildSentryOptions();
    expect(options.integrations).toBeUndefined();
    expect(options).not.toHaveProperty('tracesSampleRate');
    expect(options).not.toHaveProperty('replaysOnErrorSampleRate');
    expect(options).not.toHaveProperty('replaysSessionSampleRate');
  });

  it('never attaches default personally identifying data', () => {
    expect(buildSentryOptions().sendDefaultPii).toBe(false);
  });

  it('scrubs breadcrumbs on the way out', () => {
    expect(buildSentryOptions().beforeBreadcrumb).toBe(scrubBreadcrumb);
  });

  it('scrubs the event on the way out', () => {
    expect(buildSentryOptions().beforeSend).toBe(scrubEvent);
  });
});

/**
 * Regression guard for something the unit tests could not have found.
 *
 * Breadcrumb scrubbing was in place and a real envelope still carried the
 * whole query string, because Sentry writes `event.request.url` from
 * `window.location.href` and never routes it through `beforeBreadcrumb`. It
 * took watching an actual request to see it.
 */
describe('scrubEvent', () => {
  it('removes the query string from the page address', () => {
    const event = {
      type: undefined,
      request: { url: 'https://rotaflow.space/reset?token=abc123', headers: {} },
    } as ErrorEvent;
    expect(scrubEvent(event).request?.url).toBe('https://rotaflow.space/reset');
  });

  it('keeps the rest of the request untouched', () => {
    const event = {
      type: undefined,
      request: { url: 'https://rotaflow.space/app?x=1', headers: { 'User-Agent': 'x' } },
    } as ErrorEvent;
    expect(scrubEvent(event).request?.headers).toEqual({ 'User-Agent': 'x' });
  });

  it('passes through an event with no request on it', () => {
    const event = { type: undefined, message: 'boom' } as ErrorEvent;
    expect(scrubEvent(event)).toBe(event);
  });
});

describe('stripQueryString', () => {
  it('keeps a URL that has no query', () => {
    expect(stripQueryString('https://rotaflow.space/app/rota')).toBe(
      'https://rotaflow.space/app/rota',
    );
  });

  it('removes a Supabase filter carrying an email address', () => {
    expect(
      stripQueryString(
        'https://x.supabase.co/rest/v1/profiles?email=eq.a%40b.com&select=*',
      ),
    ).toBe('https://x.supabase.co/rest/v1/profiles');
  });

  it('removes a fragment as well', () => {
    expect(stripQueryString('https://rotaflow.space/reset#access_token=abc')).toBe(
      'https://rotaflow.space/reset',
    );
  });
});

describe('scrubBreadcrumb', () => {
  it('drops console breadcrumbs entirely', () => {
    expect(
      scrubBreadcrumb({ category: 'console', message: 'user a@b.com failed to load' }),
    ).toBeNull();
  });

  it('trims the URL on a fetch breadcrumb', () => {
    const result = scrubBreadcrumb({
      category: 'fetch',
      data: {
        url: 'https://x.supabase.co/rest/v1/staff_profiles?phone=eq.07700900000',
        method: 'GET',
      },
    });
    expect(result?.data?.url).toBe('https://x.supabase.co/rest/v1/staff_profiles');
    expect(result?.data?.method).toBe('GET');
  });

  it('leaves a breadcrumb without a URL untouched', () => {
    const crumb = { category: 'ui.click', message: 'button' };
    expect(scrubBreadcrumb(crumb)).toBe(crumb);
  });
});
