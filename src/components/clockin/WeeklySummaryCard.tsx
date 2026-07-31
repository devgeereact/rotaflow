import { BarChart3 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

export interface WeeklySummaryStat {
  label: string;
  value: string;
  /** The variance figure is the only one the reference tints green. */
  positive?: boolean;
}

interface WeeklySummaryCardProps {
  periodLabel: string;
  stats: WeeklySummaryStat[];
  /** 0-100, drives the progress bar width. */
  completedPercent: number;
  progressLabel: string;
  onViewTimesheet?: () => void;
}

/**
 * Progress width snaps to Tailwind's twelfths rather than an inline style:
 * docs/RULES.md §4 forbids `style={{}}`, and Tailwind cannot emit a class for a
 * runtime number. Twelfths keep every value a real token (no arbitrary `w-[93%]`)
 * and 8.3% granularity is finer than a 8px-tall bar resolves anyway.
 */
const WIDTHS = [
  'w-0',
  'w-1/12',
  'w-2/12',
  'w-3/12',
  'w-4/12',
  'w-5/12',
  'w-6/12',
  'w-7/12',
  'w-8/12',
  'w-9/12',
  'w-10/12',
  'w-11/12',
  'w-full',
] as const;

function widthClass(percent: number): string {
  const clamped = Math.min(100, Math.max(0, percent));
  return WIDTHS[Math.round((clamped / 100) * 12)] ?? 'w-0';
}

/** "Weekly Summary" card — hours booked vs worked, with a completion bar. */
export function WeeklySummaryCard({
  periodLabel,
  stats,
  completedPercent,
  progressLabel,
  onViewTimesheet,
}: WeeklySummaryCardProps): JSX.Element {
  return (
    <Card className="h-full rounded-xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary dark:bg-primary/15">
            <BarChart3 size={16} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-card-heading font-semibold text-content dark:text-content-dark">
              Weekly Summary
            </h2>
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              {periodLabel}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onViewTimesheet}
          className="rounded text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          View Timesheet
        </button>
      </div>

      <dl className="mt-6 flex justify-between gap-4">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dd
              className={cn(
                'text-xl font-bold',
                stat.positive ? 'text-clock' : 'text-content dark:text-content-dark',
              )}
            >
              {stat.value}
            </dd>
            <dt className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
              {stat.label}
            </dt>
          </div>
        ))}
      </dl>

      <div
        className="mt-5 h-2 w-full overflow-hidden rounded-full bg-brand/10 dark:bg-brand/20"
        role="progressbar"
        aria-valuenow={completedPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={progressLabel}
      >
        <div
          className={cn('h-full rounded-full bg-brand', widthClass(completedPercent))}
        />
      </div>
      <p className="mt-2 text-sm text-content-muted dark:text-content-muted-dark">
        {progressLabel}
      </p>
    </Card>
  );
}
