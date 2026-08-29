import { afterEach, describe, expect, it, vi } from 'vitest';

// `env` is read at module scope from Vite's inlined build-time values, so a
// test must supply its own. CI has no `.env` and therefore no
// VITE_INNGEST_EVENT_KEY — without this mock every case below would take the
// "key not configured" branch and pass or fail for the wrong reason, which is
// exactly what happened on the first CI run of this file.
// `vi.hoisted` because `vi.mock` is lifted above the imports; a plain `const`
// here is not initialised by the time the factory runs.
const mockEnv = vi.hoisted(() => ({ inngestEventKey: 'test-event-key' }));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

import {
  InngestDispatchError,
  postInngestEvent,
} from '@/services/notificationDispatchService';

const EVENT = { name: 'rota/published', data: { orgId: 'org-1' } };

afterEach(() => {
  vi.unstubAllGlobals();
  mockEnv.inngestEventKey = 'test-event-key';
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

  it('refuses without an event key, and never reaches the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    mockEnv.inngestEventKey = '';

    // 400, not 5xx: a build-time key that is absent now is absent on every
    // retry, so the outbox must dead-letter it rather than queue a certainty.
    await expect(postInngestEvent(EVENT)).rejects.toMatchObject({ status: 400 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
