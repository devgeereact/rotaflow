import { CircleAlert, Clock, Repeat } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import type { LeaveApprovalCount } from '@/lib/leaveRows';

interface LeaveApprovalQueueCardProps {
  items: LeaveApprovalCount[];
  onViewAll: () => void;
  onOpen: (id: string) => void;
}

/**
 * Glyph per queue. Keyed by the queue id the page supplies, so a queue with no
 * icon of its own still renders rather than crashing.
 */
const QUEUE_ICON: Record<string, LucideIcon> = {
  leave: CircleAlert,
  swaps: Repeat,
  overtime: Clock,
};

/**
 * The three request queues waiting on this manager (design/Leave.png).
 *
 * Counts render even at zero rather than the row disappearing — "nothing is
 * waiting" and "this queue does not exist" are different states, and a queue
 * that vanishes when it empties reads as the latter.
 */
export function LeaveApprovalQueueCard({
  items,
  onViewAll,
  onOpen,
}: LeaveApprovalQueueCardProps): JSX.Element {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[0.95rem] font-bold text-content dark:text-content-dark">
          Pending Approval
        </h2>
        <button
          type="button"
          onClick={onViewAll}
          className="rounded text-[0.8rem] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          View all
        </button>
      </div>

      <ul className="space-y-1">
        {items.map((item) => {
          const Icon = QUEUE_ICON[item.id] ?? CircleAlert;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                className="flex w-full items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-surface-subtle-dark"
              >
                <Icon
                  size={18}
                  aria-hidden="true"
                  className="shrink-0 text-secondary dark:text-secondary-dark"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.82rem] font-semibold leading-5 text-content dark:text-content-dark">
                    {item.label}
                  </p>
                  <p className="truncate text-[0.76rem] leading-4 text-content-muted dark:text-content-muted-dark">
                    {item.note}
                  </p>
                </div>
                <span className="grid h-7 min-w-7 shrink-0 place-items-center rounded-lg bg-warning/10 px-2 text-[0.8rem] font-bold tabular-nums text-warning dark:bg-warning/20">
                  {item.count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
