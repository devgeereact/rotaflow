import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InngestDispatchError,
  postInngestEvent,
} from '@/services/notificationDispatchService';

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
