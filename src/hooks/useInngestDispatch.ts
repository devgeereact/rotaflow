import { useCallback, useState } from 'react';
import { reportError } from '@/lib/sentry';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import {
  postInngestEvent,
  type InngestEventPayload,
} from '@/services/notificationDispatchService';

export interface DispatchResult {
  /** The event reached Inngest on this attempt. */
  ok: boolean;
  /** It did not, but it is in the outbox and will be retried on reconnect. */
  queued: boolean;
}

export interface UseInngestDispatch {
  sending: boolean;
  send: (name: string, data: Record<string, unknown>) => Promise<DispatchResult>;
}

/**
 * Dispatch a domain event to Inngest, which forwards it to the
 * `send-notification` Edge Function.
 *
 * ## What changed, and why (BUG-047)
 *
 * This used to be genuinely fire-and-forget: a failure went to Sentry and
 * nowhere else. The caller could not tell, the user could not tell, and
 * nothing retried. So a rota would publish successfully and its staff would
 * simply never be told, with a success toast on screen and no record anywhere
 * that a notification had been owed.
 *
 * A failed dispatch is now **queued in the same IndexedDB outbox that carries
 * offline clock-ins**, under the `notify` kind, and replayed on reconnect with
 * the outbox's existing transient/permanent classification, attempt cap and
 * dead-letter surface. Nothing else in the app had to learn a new mechanism.
 *
 * It still does not throw into the UI — a publish that succeeded should not
 * look like a failure — but it now reports which of the three things happened,
 * so a caller can tell the user the truth.
 *
 * ## What this does NOT fix
 *
 * The dispatch is still initiated by the browser. If the tab is closed before
 * the request settles and the outbox write has not flushed, the event is lost.
 * Making publication itself carry the notification needs it to move
 * server-side, into `publish_rota` or a trigger — see `docs/SAAS.md` GAP-026.
 */
export function useInngestDispatch(): UseInngestDispatch {
  const [sending, setSending] = useState(false);
  const { enqueue } = useSyncQueue();

  const send = useCallback(
    async (name: string, data: Record<string, unknown>): Promise<DispatchResult> => {
      setSending(true);
      try {
        await postInngestEvent({ name, data });
        return { ok: true, queued: false };
      } catch (error) {
        reportError(error, { event: name, area: 'notify:dispatch' });
        try {
          const payload: InngestEventPayload = { name, data };
          await enqueue('notify', payload);
          return { ok: false, queued: true };
        } catch (queueError) {
          // The outbox itself is unavailable — private browsing with IndexedDB
          // blocked, or storage full. Nothing left to fall back to, so say so
          // rather than reporting a queue that does not exist.
          reportError(queueError, { event: name, area: 'notify:enqueue' });
          return { ok: false, queued: false };
        }
      } finally {
        setSending(false);
      }
    },
    [enqueue],
  );

  return { sending, send };
}
