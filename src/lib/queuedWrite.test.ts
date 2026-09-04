import { describe, expect, it, vi } from 'vitest';
import { sendOrQueue } from '@/lib/queuedWrite';

describe('sendOrQueue', () => {
  it('queues without attempting the write when the device is known to be offline', async () => {
    const send = vi.fn();
    const queue = vi.fn().mockResolvedValue(undefined);

    const result = await sendOrQueue({
      online: false,
      send,
      queue,
      isTransient: () => true,
    });

    expect(result).toEqual({ status: 'queued' });
    expect(send).not.toHaveBeenCalled();
    expect(queue).toHaveBeenCalledOnce();
  });

  it('returns the row when the write lands', async () => {
    const queue = vi.fn();
    const result = await sendOrQueue({
      online: true,
      send: () => Promise.resolve({ id: 'leave-1' }),
      queue,
      isTransient: () => true,
    });

    expect(result).toEqual({ status: 'sent', row: { id: 'leave-1' } });
    expect(queue).not.toHaveBeenCalled();
  });

  // The case this file exists for: navigator.onLine said true and was wrong.
  it('queues a transient failure that happened while the browser thought it was online', async () => {
    const queue = vi.fn().mockResolvedValue(undefined);

    const result = await sendOrQueue({
      online: true,
      send: () => Promise.reject(new TypeError('Failed to fetch')),
      queue,
      isTransient: () => true,
    });

    expect(result).toEqual({ status: 'queued' });
    expect(queue).toHaveBeenCalledOnce();
  });

  // A refusal is not a network problem. Queueing it would replay it five
  // times and then tell the person it did not happen -- which was true from
  // the first attempt, and is worth saying immediately.
  it('rethrows a permanent failure instead of queueing it', async () => {
    const queue = vi.fn();
    const refused = Object.assign(new Error('row-level security'), { code: '42501' });

    await expect(
      sendOrQueue({
        online: true,
        send: () => Promise.reject(refused),
        queue,
        isTransient: () => false,
      }),
    ).rejects.toBe(refused);

    expect(queue).not.toHaveBeenCalled();
  });
});
