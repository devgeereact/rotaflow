/**
 * One shape for "send it, and if the network lied, queue it instead".
 *
 * `ClockInPage` has had this since BUG-046: `navigator.onLine` can say true
 * on a captive portal or an associated-but-dead wifi, which is routine on a
 * ward, and a write that fails that way has to reach the outbox rather than a
 * toast. Leave and swap requests did not — they queued only when
 * `navigator.onLine` was already false, so a transient failure while
 * "online" showed "Could not submit that request. Please try again." and
 * dropped the work on the floor.
 *
 * Pure on purpose: `send`, `queue` and `isTransient` all arrive as arguments,
 * so this is unit-testable without a Supabase client, a WebSocket or a
 * browser. See `queuedWrite.test.ts`.
 */

export type QueuedWriteOutcome<T> = { status: 'sent'; row: T } | { status: 'queued' };

export interface QueuedWriteArgs<T> {
  /** What the browser currently believes. Not trusted on its own — see above. */
  online: boolean;
  send: () => Promise<T>;
  queue: () => Promise<void>;
  /**
   * Whether a failure is worth queueing. `classifyFailure` from
   * `services/syncQueue.ts` in production; anything permanent (the server
   * refused it) is rethrown so the caller can tell the person it did not
   * happen, which is true and actionable.
   */
  isTransient: (err: unknown) => boolean;
}

export async function sendOrQueue<T>({
  online,
  send,
  queue,
  isTransient,
}: QueuedWriteArgs<T>): Promise<QueuedWriteOutcome<T>> {
  if (!online) {
    await queue();
    return { status: 'queued' };
  }

  try {
    return { status: 'sent', row: await send() };
  } catch (err) {
    if (!isTransient(err)) throw err;
    await queue();
    return { status: 'queued' };
  }
}
