import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/lib/sentry', () => ({ reportError: vi.fn() }));

import { reportError } from '@/lib/sentry';
import { releasePushSubscription } from '@/lib/session';

/**
 * Plan S4: signing out on a shared device must stop that browser receiving the
 * outgoing user's notifications, and must never be blocked by trying.
 */

const ENDPOINT = 'https://push.example.test/endpoint-a';

interface FakeSubscription {
  endpoint: string;
  unsubscribe: Mock<() => Promise<boolean>>;
}

function stubBrowser(subscription: FakeSubscription | null, registered = true): void {
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: vi.fn(() =>
        Promise.resolve(
          registered
            ? {
                pushManager: {
                  getSubscription: vi.fn(() => Promise.resolve(subscription)),
                },
              }
            : undefined,
        ),
      ),
    },
  });
}

function fakeSubscription(): FakeSubscription {
  return { endpoint: ENDPOINT, unsubscribe: vi.fn(() => Promise.resolve(true)) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('releasePushSubscription', () => {
  it('deletes the server row, then unsubscribes the browser', async () => {
    const order: string[] = [];
    const subscription = fakeSubscription();
    subscription.unsubscribe.mockImplementation(() => {
      order.push('unsubscribe');
      return Promise.resolve(true);
    });
    stubBrowser(subscription);
    const deleteRow = vi.fn((endpoint: string): Promise<void> => {
      order.push(`delete:${endpoint}`);
      return Promise.resolve();
    });

    await releasePushSubscription(deleteRow);

    expect(order).toEqual([`delete:${ENDPOINT}`, 'unsubscribe']);
  });

  it('still unsubscribes the browser when the row cannot be deleted (offline)', async () => {
    const subscription = fakeSubscription();
    stubBrowser(subscription);
    const deleteRow = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));

    await expect(releasePushSubscription(deleteRow)).resolves.toBeUndefined();

    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(expect.any(TypeError), {
      area: 'session:push-row-delete',
    });
  });

  it('does not throw when the browser refuses to unsubscribe', async () => {
    const subscription = fakeSubscription();
    subscription.unsubscribe.mockRejectedValue(new Error('InvalidStateError'));
    stubBrowser(subscription);

    await expect(releasePushSubscription(vi.fn(async () => {}))).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
      area: 'session:push-unsubscribe',
    });
  });

  it('does nothing when this browser has no subscription', async () => {
    stubBrowser(null);
    const deleteRow = vi.fn(async () => {});

    await releasePushSubscription(deleteRow);

    expect(deleteRow).not.toHaveBeenCalled();
  });

  it('does nothing when no service worker is registered', async () => {
    stubBrowser(fakeSubscription(), false);
    const deleteRow = vi.fn(async () => {});

    await releasePushSubscription(deleteRow);

    expect(deleteRow).not.toHaveBeenCalled();
  });

  it('does nothing where service workers do not exist at all', async () => {
    vi.stubGlobal('navigator', {});
    const deleteRow = vi.fn(async () => {});

    await expect(releasePushSubscription(deleteRow)).resolves.toBeUndefined();
    expect(deleteRow).not.toHaveBeenCalled();
  });

  it('gives up after the timeout rather than holding sign-out', async () => {
    stubBrowser(fakeSubscription());
    const deleteRow = vi.fn(() => new Promise<void>(() => {}));

    const started = Date.now();
    await releasePushSubscription(deleteRow, 20);

    expect(deleteRow).toHaveBeenCalledOnce();
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
