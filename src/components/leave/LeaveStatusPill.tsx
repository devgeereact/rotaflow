import { cn } from '@/lib/utils';
import { LEAVE_STATUS_LABEL, LEAVE_STATUS_TONE } from '@/lib/leaveStatus';
import type { LeaveStatus } from '@/lib/leaveRows';

interface LeaveStatusPillProps {
  status: LeaveStatus;
  className?: string;
}

/**
 * Request state as a tinted pill. Always spelled out in words. Status is
 * never carried by colour alone (docs/DESIGN.md §5).
 */
export function LeaveStatusPill({
  status,
  className,
}: LeaveStatusPillProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[0.72rem] font-semibold',
        LEAVE_STATUS_TONE[status],
        className,
      )}
    >
      {LEAVE_STATUS_LABEL[status]}
    </span>
  );
}
