import { AlertTriangle, RotateCcw, X } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/Button';
import type { DeadLetterRecord } from '@/lib/offlineOutbox';

const KIND_LABELS: Record<DeadLetterRecord['kind'], string> = {
  clock: 'Clock event',
  leave: 'Leave request',
  swap: 'Shift swap request',
  notify: 'Staff notification',
};

/**
 * `notify` is the one kind where the underlying action DID happen.
 *
 * A rota cannot be published offline — `publishRota` calls an RPC — so a
 * dead-lettered `notify` means the publish landed and only the announcement of
 * it failed. Telling that manager "it did not happen, do it again" would send
 * them back to republish a rota that is already live. The two cases therefore
 * get different wording, and this is the whole reason the notice is split.
 */
function actionFailed(item: DeadLetterRecord): boolean {
  return item.kind !== 'notify';
}

interface Props {
  items: DeadLetterRecord[];
  onDiscard: (id: string) => void | Promise<void>;
  /**
   * Try the write again (CAP-016). Optional: a caller that has no queue to
   * flush into simply does not offer it, rather than being handed a button
   * that does nothing.
   */
  onRetry?: (id: string) => void | Promise<void>;
  className?: string;
}

/**
 * Writes that were queued offline and can never be delivered. The server
 * refused them, or they ran out of retries (`services/syncQueue.ts`).
 *
 * This component is the reason the dead-letter store is worth having. The
 * outbox's failure mode is that a write is accepted into IndexedDB, reported to
 * the person as done, and then never lands. For a clock event that ends as a
 * wrong payslip. Setting the write aside so it stops blocking the queue fixes
 * the deadlock but not the silence; only showing it does that.
 *
 * So the wording says the thing plainly, **it did not save, do it again**,
 * rather than "sync error". The person who tapped Clock in believes they are
 * clocked in, and the only useful message is the one that corrects that.
 *
 * Discarding is deliberately explicit and per-item. Nothing here expires or
 * clears itself: an un-acknowledged failed clock-in should keep nagging.
 *
 * Since BUG-047 the outbox also carries `notify`, where the opposite is true —
 * the write landed and only the notification failed. Those render as their own
 * group with their own wording, because the sentence above ("they did not
 * happen, do them again") would send a manager off to republish a rota that is
 * already live. See `actionFailed`.
 */
export function FailedWritesNotice({
  items,
  onDiscard,
  onRetry,
  className,
}: Props): JSX.Element | null {
  if (items.length === 0) return null;

  const lost = items.filter(actionFailed);
  const unannounced = items.filter((item) => !actionFailed(item));

  return (
    <>
      {lost.length > 0 && (
        <FailedGroup
          items={lost}
          className={className}
          heading={
            lost.length === 1
              ? "1 action didn't save"
              : `${lost.length} actions didn't save`
          }
          body={
            <>
              These were saved on this device while you were offline, but the server
              rejected them. <strong>They did not happen</strong>. Please do them again,
              or ask your manager to add them for you.
            </>
          }
          onDiscard={onDiscard}
          onRetry={onRetry}
        />
      )}
      {unannounced.length > 0 && (
        <FailedGroup
          items={unannounced}
          className={className}
          heading={
            unannounced.length === 1
              ? '1 notification was not sent'
              : `${unannounced.length} notifications were not sent`
          }
          body={
            <>
              <strong>Your change was saved</strong> — the rota, leave decision or swap
              went through. What failed was telling the staff it affects. Nobody was
              notified, so let them know another way.
            </>
          }
          onDiscard={onDiscard}
          onRetry={onRetry}
        />
      )}
    </>
  );
}

interface GroupProps extends Props {
  heading: string;
  body: JSX.Element;
}

function FailedGroup({
  items,
  onDiscard,
  onRetry,
  className,
  heading,
  body,
}: GroupProps): JSX.Element {
  return (
    <section
      // `assertive`: this contradicts a success message the user has already
      // been shown, so it should not wait for a pause in screen-reader output.
      role="alert"
      aria-live="assertive"
      className={`rounded-xl border border-danger/30 bg-danger/5 p-4 ${className ?? ''}`}
    >
      <div className="mb-3 flex items-start gap-2">
        <AlertTriangle
          size={18}
          className="mt-0.5 shrink-0 text-danger"
          aria-hidden="true"
        />
        <div>
          <h2 className="text-sm font-semibold text-danger">{heading}</h2>
          <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
            {body}
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-start justify-between gap-3 rounded-lg bg-surface px-3 py-2 dark:bg-surface-dark"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-content dark:text-content-dark">
                {KIND_LABELS[item.kind]}
              </p>
              <p className="text-xs text-content-muted dark:text-content-muted-dark">
                Attempted {format(new Date(item.queuedAt), 'd MMM yyyy, HH:mm')}
                {item.reason === 'exhausted' ? ' · could not reach the server' : ''}
              </p>
            </div>
            {/* Retry first: for most of these the payload was always correct
                and only the moment was wrong — a ward's wifi during handover,
                a shift published a minute later. Dismiss stays as the way to
                acknowledge one that genuinely cannot work. */}
            <div className="flex shrink-0 items-center gap-1">
              {onRetry && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void onRetry(item.id)}
                  aria-label={`Try the ${KIND_LABELS[item.kind].toLowerCase()} from ${format(new Date(item.queuedAt), 'd MMM, HH:mm')} again`}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  <span className="ml-1">Try again</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onDiscard(item.id)}
                aria-label={`Dismiss failed ${KIND_LABELS[item.kind].toLowerCase()} from ${format(new Date(item.queuedAt), 'd MMM, HH:mm')}`}
              >
                <X size={14} aria-hidden="true" />
                <span className="ml-1">Dismiss</span>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
