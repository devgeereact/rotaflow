import { Plus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { StaffAvatar } from '@/components/ui/StaffAvatar';

export interface PendingAvailabilityRequest {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl?: string | null;
  /** What is being asked for, e.g. "Change 31 May". */
  summary: string;
  /** The window or days it applies to, e.g. "15:00 – 23:00". */
  detail: string;
  statusLabel: string;
}

interface PendingRequestsCardProps {
  requests: PendingAvailabilityRequest[];
  moreCount: number;
  onViewAll: () => void;
  onOpen?: (id: string) => void;
}

/** Availability changes waiting on a manager's decision. */
export function PendingRequestsCard({
  requests,
  moreCount,
  onViewAll,
  onOpen,
}: PendingRequestsCardProps): JSX.Element {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-card-heading font-semibold text-content dark:text-content-dark">
          Pending Requests
        </h2>
        <button
          type="button"
          onClick={onViewAll}
          className="rounded text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          View all
        </button>
      </div>

      <ul className="mt-3 space-y-3">
        {requests.map((request) => (
          <li key={request.id}>
            <button
              type="button"
              onClick={onOpen ? () => onOpen(request.id) : undefined}
              className="flex w-full items-start gap-2.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <StaffAvatar
                firstName={request.firstName}
                lastName={request.lastName}
                photoUrl={request.photoUrl}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-content dark:text-content-dark">
                  {request.firstName} {request.lastName}
                </p>
                <p className="text-xs text-content-muted dark:text-content-muted-dark">
                  {request.summary}
                </p>
                <p className="text-xs text-content-muted dark:text-content-muted-dark">
                  {request.detail}
                </p>
              </div>
              <span className="shrink-0 rounded-md bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
                {request.statusLabel}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {moreCount > 0 && (
        <button
          type="button"
          onClick={onViewAll}
          className="mt-3 flex items-center gap-1.5 rounded text-sm text-content dark:text-content-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Plus size={14} aria-hidden="true" />
          {moreCount} more pending
        </button>
      )}
    </Card>
  );
}
