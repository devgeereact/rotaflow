import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

interface ScheduleStatCardProps {
  icon: LucideIcon;
  /** Icon colour class, e.g. `text-primary`. The reference tiles are untinted. */
  tint: string;
  label: string;
  value: string;
  /** Small line under the value, a target, a delta, a breakdown. */
  hint?: ReactNode;
}

/**
 * One tile in the summary row above the schedule grid
 * (design/published-schedule.png): a plain outline icon on the left, with
 * label / value / hint stacked to its right. Six sit side by side on a
 * desktop rota, so the type is deliberately small and never wraps.
 */
export function ScheduleStatCard({
  icon: Icon,
  tint,
  label,
  value,
  hint,
}: ScheduleStatCardProps): JSX.Element {
  return (
    <Card className="flex items-center gap-2.5 px-3.5 py-3.5">
      <Icon size={24} aria-hidden="true" className={cn('shrink-0', tint)} />
      <div className="min-w-0">
        <p className="truncate text-[0.66rem] font-medium leading-4 text-content-muted dark:text-content-muted-dark">
          {label}
        </p>
        <p className="text-[1.2rem] font-bold leading-7 text-content dark:text-content-dark">
          {value}
        </p>
        {hint !== undefined && (
          <div className="flex items-center gap-1.5 whitespace-nowrap text-[0.66rem] leading-4 text-content-muted dark:text-content-muted-dark">
            {hint}
          </div>
        )}
      </div>
    </Card>
  );
}
