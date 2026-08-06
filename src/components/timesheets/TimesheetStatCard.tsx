import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

interface TimesheetStatCardProps {
  icon: LucideIcon;
  /** Tile classes, e.g. `bg-primary/10 text-primary`. */
  tint: string;
  label: string;
  value: string;
  /** Small line under the value, a comparison, a share, a total. */
  hint?: ReactNode;
}

/**
 * One tile in the summary row above the timesheet table
 * (design/Timesheets-Dashboard.png): a tinted rounded icon tile on the left,
 * label / value / hint stacked to its right.
 */
export function TimesheetStatCard({
  icon: Icon,
  tint,
  label,
  value,
  hint,
}: TimesheetStatCardProps): JSX.Element {
  return (
    <Card className="flex-auto p-3.5">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', tint)}
        >
          <Icon size={17} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[0.67rem] font-medium leading-4 text-content-muted dark:text-content-muted-dark">
            {label}
          </p>
          <p className="text-[1.25rem] font-bold leading-8 text-content dark:text-content-dark">
            {value}
          </p>
        </div>
      </div>
      {hint !== undefined && (
        <div className="mt-1 flex items-center justify-center gap-1 whitespace-nowrap text-[0.58rem] leading-4 text-content-muted dark:text-content-muted-dark">
          {hint}
        </div>
      )}
    </Card>
  );
}
