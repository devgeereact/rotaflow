import { cn } from '@/lib/utils';
import { coverageTone } from '@/lib/locationsDirectory';

const FILLS = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
} as const;

/**
 * Coverage percentage over a thin progress track. The Coverage / Avg. Coverage
 * column on both locations references. The number carries the meaning; the bar
 * only reinforces it (docs/DESIGN.md §5: never colour alone).
 *
 * The width is an inline style, as on `DashboardView`'s required-staff bar and
 * the splash/app-boot progress bars. `WeeklySummaryCard`'s twelfths trick is
 * the usual way around docs/RULES.md §4, but 8.3% steps on a 76px track would
 * collapse this screen's 95 / 93 / 91 rows into one identical bar, and telling
 * those apart at a glance is the column's entire job.
 */
export function CoverageMeter({ percent }: { percent: number }): JSX.Element {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="w-20">
      <p className="text-sm font-semibold text-content dark:text-content-dark">
        {percent}%
      </p>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-divider dark:bg-surface-subtle-dark">
        <div
          className={cn('h-full rounded-full', FILLS[coverageTone(clamped)])}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
