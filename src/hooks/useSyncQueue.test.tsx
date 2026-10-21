/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Two instances of `useSyncQueue` on one screen must agree about the outbox.
 *
 * `OfflineQueueDrain` in the shell and the clock screen each mount the hook.
 * The shell's instance replays the queue; until 2026-10-21 the clock screen's
 * kept its own stale `pending` and went on saying "Sending 1 entry" about a
 * clock-in that was already in Postgres. `e2e/offline-clock-in.spec.ts` found
 * it; this pins the mechanism without a browser.
 */

let queued: { id: string }[] = [];

const services = vi.hoisted(() => ({
  listQueuedWrites: vi.fn(),
  listDeadLetteredWrites: vi.fn(),
  flushQueuedWrites: vi.fn(),
  enqueueWrite: vi.fn(),
  discardDeadLetteredWrite: vi.fn(),
  retryDeadLetteredWrite: vi.fn(),
}));

vi.mock('@/services/syncQueue', () => services);
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: (): boolean => true }));
vi.mock('@/hooks/useSupabaseAuth', () => ({
  useSupabaseAuth: (): { user: { id: string } } => ({ user: { id: 'user-1' } }),
}));
vi.mock('@/lib/sentry', () => ({ reportError: vi.fn() }));

describe('useSyncQueue', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('tells every other instance when one of them empties the outbox', async () => {
    queued = [{ id: 'a' }];
    services.listQueuedWrites.mockImplementation(() => Promise.resolve(queued));
    services.listDeadLetteredWrites.mockResolvedValue([]);
    // The Web Lock, as the browser applies it: the first flush holds it and
    // does the work slowly; a flush that arrives meanwhile gets nothing and
    // returns at once, while the write is still in the outbox.
    let held = false;
    services.flushQueuedWrites.mockImplementation(async () => {
      if (held) return { synced: 0, failed: 0, deadLettered: 0 };
      held = true;
      await new Promise((resolve) => setTimeout(resolve, 50));
      queued = [];
      held = false;
      return { synced: 1, failed: 0, deadLettered: 0 };
    });

    const { useSyncQueue } = await import('@/hooks/useSyncQueue');
    const shell = renderHook(() => useSyncQueue());
    const screen = renderHook(() => useSyncQueue());

    // Both mount with work waiting and both flush on start. One wins the lock;
    // the other reads the list mid-flight and, on its own, would keep it.
    await waitFor(() => expect(shell.result.current.pending).toHaveLength(0));
    await waitFor(() => expect(screen.result.current.pending).toHaveLength(0));
    expect(services.flushQueuedWrites).toHaveBeenCalledTimes(2);
  });

  it('refreshes on the announcement alone, without flushing in reply', async () => {
    queued = [{ id: 'a' }];
    services.listQueuedWrites.mockImplementation(() => Promise.resolve(queued));
    services.listDeadLetteredWrites.mockResolvedValue([]);
    services.flushQueuedWrites.mockResolvedValue({
      synced: 0,
      failed: 0,
      deadLettered: 0,
    });

    const { useSyncQueue, OUTBOX_CHANGED_EVENT } = await import('@/hooks/useSyncQueue');
    const screen = renderHook(() => useSyncQueue());
    await waitFor(() => expect(screen.result.current.pending).toHaveLength(1));
    const flushesBefore = services.flushQueuedWrites.mock.calls.length;

    queued = [];
    act(() => {
      window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
    });

    await waitFor(() => expect(screen.result.current.pending).toHaveLength(0));
    expect(services.flushQueuedWrites.mock.calls.length).toBe(flushesBefore);
  });
});
