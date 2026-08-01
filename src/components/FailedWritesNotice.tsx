import { AlertTriangle, X } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/Button';
import type { DeadLetterRecord } from '@/lib/offlineOutbox';

const KIND_LABELS: Record<DeadLetterRecord['kind'], string> = {
  clock: 'Clock event',
  leave: 'Leave request',
  swap: 'Shift swap request',
};

interface Props {
  items: DeadLetterRecord[];
  onDiscard: (id: string) => void | Promise<void>;
  className?: string;
}

/**
 * Writes that were queued offline and can never be delivered — the server
 * refused them, or they ran out of retries (`services/syncQueue.ts`).
 *
 * This component is the reason the dead-letter store is worth having. The
 * outbox's failure mode is that a write is accepted into IndexedDB, reported to
 * the person as done, and then never lands. For a clock event that ends as a
 * wrong payslip. Setting the write aside so it stops blocking the queue fixes
 * the deadlock but not the silence; only showing it does that.
 *
 * So the wording says the thing plainly — **it did not save, do it again** —
 * rather than "sync error". The person who tapped Clock in believes they are
 * clocked in, and the only useful message is the one that corrects that.
 *
 * Discarding is deliberately explicit and per-item. Nothing here expires or
 * clears itself: an un-acknowledged failed clock-in should keep nagging.
 */
export function FailedWritesNotice({
  items,
  onDiscard,
  className,
}: Props): JSX.Element | null {
  if (items.length === 0) return null;

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
          <h2 className="text-sm font-semibold text-danger">
            {items.length === 1
              ? "1 action didn't save"
              : `${items.length} actions didn't save`}
          </h2>
          <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
            These were saved on this device while you were offline, but the server
            rejected them. <strong>They did not happen</strong> — please do them again, or
            ask your manager to add them for you.
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onDiscard(item.id)}
              aria-label={`Dismiss failed ${KIND_LABELS[item.kind].toLowerCase()} from ${format(new Date(item.queuedAt), 'd MMM, HH:mm')}`}
            >
              <X size={14} aria-hidden="true" />
              <span className="ml-1">Dismiss</span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
