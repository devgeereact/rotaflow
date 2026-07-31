import { Link } from 'react-router-dom';
import { ArrowLeftRight } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { StaffAvatar } from '@/components/ui/StaffAvatar';

export interface ScheduleRequest {
  id: string;
  /** "Annual Leave", "Swap Request", "Overtime Request". */
  kind: string;
  /** Requester's display name — split for the avatar's initials fallback. */
  name: string;
  photoUrl: string | null;
  /** The other party on a swap — rendered under the requester. */
  counterpartName?: string | null;
  /** Pre-formatted, e.g. "30 May 2025". */
  dateLabel: string;
  status: 'pending' | 'approved' | 'declined';
}

interface OpenRequestsCardProps {
  requests: ScheduleRequest[];
  /** Where "View all" goes — leave requests and swaps have their own screens. */
  viewAllTo: string;
}

const STATUS_TONE = {
  pending: 'warning',
  approved: 'success',
  declined: 'danger',
} as const;

/**
 * Leave, swap and overtime requests still waiting on a manager, beside the
 * published rota (design/live-schedule.png).
 */
export function OpenRequestsCard({
  requests,
  viewAllTo,
}: OpenRequestsCardProps): JSX.Element {
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-card-heading font-semibold text-content dark:text-content-dark">
          Open Requests
        </h2>
        <Link to={viewAllTo} className="text-xs font-medium text-primary hover:underline">
          View all
        </Link>
      </div>

      {requests.length === 0 ? (
        <p className="border-t border-divider px-4 py-4 text-sm text-content-muted dark:border-divider-dark dark:text-content-muted-dark">
          Nothing waiting on you.
        </p>
      ) : (
        <ul>
          {requests.map((request) => (
            <li
              key={request.id}
              className="flex items-start gap-2.5 border-t border-divider px-4 py-3 dark:border-divider-dark"
            >
              <StaffAvatar
                firstName={request.name.split(' ')[0] ?? request.name}
                lastName={request.name.split(' ')[1] ?? ''}
                photoUrl={request.photoUrl}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-content dark:text-content-dark">
                  {request.kind}
                </p>
                <p className="truncate text-[0.8rem] font-semibold text-content dark:text-content-dark">
                  {request.name}
                </p>
                {request.counterpartName && (
                  <p className="flex items-center gap-1 truncate text-[0.8rem] font-medium text-content dark:text-content-dark">
                    <ArrowLeftRight
                      size={12}
                      aria-hidden="true"
                      className="text-content-muted dark:text-content-muted-dark"
                    />
                    {request.counterpartName}
                  </p>
                )}
                <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                  {request.dateLabel}
                </p>
              </div>
              <Badge tone={STATUS_TONE[request.status]} className="capitalize">
                {request.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
