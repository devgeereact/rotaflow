import { Plus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { StaffAvatar } from '@/components/ui/StaffAvatar';

export interface PendingTimesheet {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  /** Pre-formatted, e.g. "Submitted today, 09:15". */
  submittedLabel: string;
  /** Pre-formatted, e.g. "32.00 hours". */
  hoursLabel: string;
}

interface PendingApprovalCardProps {
  items: PendingTimesheet[];
  /** How many more are waiting beyond the ones listed. */
  moreCount: number;
  onViewAll: () => void;
  onOpen: (id: string) => void;
}

/** Timesheets waiting on a decision (design/Timesheets-Dashboard.png). */
export function PendingApprovalCard({
  items,
  moreCount,
  onViewAll,
  onOpen,
}: PendingApprovalCardProps): JSX.Element {
  return (
    <Card className="p-3.5">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[0.9rem] font-semibold text-content dark:text-content-dark">
          Pending Approval
        </h2>
        <button
          type="button"
          onClick={onViewAll}
          className="text-xs font-medium text-primary hover:underline"
        >
          View all
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Nothing waiting on you.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                className="flex w-full items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-surface-subtle-dark"
              >
                <StaffAvatar
                  firstName={item.firstName}
                  lastName={item.lastName}
                  photoUrl={item.photoUrl}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.76rem] font-semibold leading-5 text-content dark:text-content-dark">
                    {item.firstName} {item.lastName}
                  </p>
                  <p className="truncate text-[0.7rem] leading-4 text-content-muted dark:text-content-muted-dark">
                    {item.submittedLabel}
                  </p>
                </div>
                <span className="shrink-0 self-start text-[0.7rem] tabular-nums text-content-muted dark:text-content-muted-dark">
                  {item.hoursLabel}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {moreCount > 0 && (
        <button
          type="button"
          onClick={onViewAll}
          className="mt-3 flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <Plus size={13} aria-hidden="true" />
          {moreCount} more pending
        </button>
      )}
    </Card>
  );
}
