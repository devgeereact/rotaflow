import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InngestDispatchError,
  postInngestEvent,
} from '@/services/notificationDispatchService';
import { classifyFailure } from '@/services/syncQueue';

const EVENT = { name: 'rota/published', data: { orgId: 'org-1' } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postInngestEvent', () => {
  it('resolves when Inngest accepts the event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    await expect(postInngestEvent(EVENT)).resolves.toBeUndefined();
  });

  it('throws rather than swallowing, so the caller can queue it', async () => {
    // The whole point of BUG-047: a dispatch that fails silently is
    // indistinguishable from one that worked.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(postInngestEvent(EVENT)).rejects.toBeInstanceOf(InngestDispatchError);
  });

  it('carries the HTTP status so the outbox can classify the failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(postInngestEvent(EVENT)).rejects.toMatchObject({ status: 503 });
  });
});

describe('a failed dispatch classifies the way the outbox expects', () => {
  it('retries a 5xx — Inngest being down is not our payload being wrong', () => {
    expect(classifyFailure(new InngestDispatchError('down', 503))).toBe('transient');
  });

  it('retries a dropped connection', () => {
    // A blocked or dropped request rejects as a TypeError with no status,
    // which is what a content blocker eating `inn.gs` looks like.
    expect(classifyFailure(new TypeError('Failed to fetch'))).toBe('transient');
  });

  it('does not retry a rejected payload', () => {
    expect(classifyFailure(new InngestDispatchError('bad request', 400))).toBe(
      'permanent',
    );
  });

  it('treats a missing event key as permanent, so it cannot fill the outbox', () => {
    // A build-time key that is absent now will be absent on every retry.
    expect(classifyFailure(new InngestDispatchError('no key', 400))).toBe('permanent');
  });
});
