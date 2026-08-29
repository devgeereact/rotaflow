import { env } from '@/lib/env';

/**
 * Posting a domain event to Inngest, which forwards it to the
 * `send-notification` Edge Function.
 *
 * This lives in a service rather than inside `useInngestDispatch` because two
 * callers need it and only one of them is a component: the hook, and the
 * offline outbox's `notify` replayer (`src/services/syncQueue.ts`), which has
 * no React context to reach a hook from.
 *
 * ## Why the retry path exists (BUG-047)
 *
 * The dispatch used to be a bare `void send(...)` at four call sites. It
 * throws nothing, records nothing, and retries nothing, which made a specific
 * failure invisible: the rota publishes over the network successfully, and
 * then this *second, separate* request to a third-party domain fails. Staff
 * are never told, the manager sees a success toast, and nothing anywhere
 * records that a notification was owed.
 *
 * That is not a hypothetical. `inn.gs` is exactly the shape of hostname
 * content blockers drop, so the request can fail on a perfectly healthy
 * connection, for one user, forever.
 *
 * Note that a rota cannot be published offline at all — `publishRota` calls
 * the `publish_rota` RPC, which needs the network. So the failure this guards
 * is not "the manager was offline"; it is "the write landed and the
 * notification did not".
 */

/** Thrown so the caller can classify it exactly like any other queued write. */
export class InngestDispatchError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'InngestDispatchError';
    this.status = status;
  }
}

export interface InngestEventPayload {
  name: string;
  data: Record<string, unknown>;
}

/**
 * POST one event to Inngest's ingest API with the write-only event key.
 *
 * Throws on any failure, deliberately: the outbox decides what is worth
 * retrying (`classifyFailure`), and it can only do that if it is given the
 * error. `status` is carried on the error so a 5xx retries and a 4xx does not.
 */
export async function postInngestEvent({
  name,
  data,
}: InngestEventPayload): Promise<void> {
  if (!env.inngestEventKey) {
    // Not retryable. A missing build-time key will still be missing on the
    // next attempt, so queuing it would just fill the outbox with certainties.
    throw new InngestDispatchError('Inngest event key not configured', 400);
  }

  const res = await fetch(`https://inn.gs/e/${env.inngestEventKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data }),
  });

  if (!res.ok) {
    throw new InngestDispatchError(`Inngest dispatch failed: ${res.status}`, res.status);
  }
}
