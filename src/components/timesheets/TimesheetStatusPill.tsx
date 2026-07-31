import { cn } from '@/lib/utils';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/timesheetStatus';
import type { TimesheetStatus } from '@/lib/timesheetRows';

interface TimesheetStatusPillProps {
  status: TimesheetStatus;
  className?: string;
}

/**
 * Timesheet state as a tinted pill. Always spelled out in words — status is
 * never carried by colour alone (docs/DESIGN.md §5).
 */
export function TimesheetStatusPill({
  status,
  className,
}: TimesheetStatusPillProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-lg px-1.5 py-1 text-[0.66rem] font-semibold',
        STATUS_TONE[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
