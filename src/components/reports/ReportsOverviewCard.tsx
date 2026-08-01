import { ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { DonutChart } from '@/components/ui/DonutChart';
import { cn } from '@/lib/utils';
import type { ReportFilterOption } from '@/components/reports/ReportsFilterBar';

export interface ReportsOverviewSegment {
  id: string;
  label: string;
  value: number;
  /** Percentage of the total, already rounded by the caller. */
  percent: number;
  /** Tailwind token classes for the ring arc and the legend dot. */
  strokeClass: string;
  dotClass: string;
}

interface ReportsOverviewCardProps {
  segments: ReportsOverviewSegment[];
  total: number;
  ranges: ReportFilterOption[];
  range: string;
  onRangeChange: (value: string) => void;
  /** Shown in place of the ring when nothing has been generated yet. */
  emptyMessage: string;
}

/** Ring + legend breakdown of the period's report runs. */
export function ReportsOverviewCard({
  segments,
  total,
  ranges,
  range,
  onRangeChange,
  emptyMessage,
}: ReportsOverviewCardProps): JSX.Element {
  return (
    <Card className="px-6 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-content dark:text-content-dark">
          Reports Overview
        </h2>
        <div className="relative flex h-8 items-center rounded-lg border border-surface-border px-3 focus-within:ring-2 focus-within:ring-primary dark:border-surface-border-dark">
          <select
            value={range}
            onChange={(event) => onRangeChange(event.target.value)}
            aria-label="Overview period"
            className="w-full appearance-none bg-transparent pr-4 text-[0.8rem] font-semibold text-content outline-none dark:text-content-dark"
          >
            {ranges.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute right-2 text-content-muted dark:text-content-muted-dark"
          />
        </div>
      </div>

      {total === 0 ? (
        <p className="py-6 text-center text-sm text-content-muted dark:text-content-muted-dark">
          {emptyMessage}
        </p>
      ) : (
        <div className="flex items-center gap-10">
          <DonutChart
            segments={segments.map((segment) => ({
              id: segment.id,
              label: segment.label,
              value: segment.value,
              strokeClass: segment.strokeClass,
            }))}
            centreValue={String(total)}
            centreLabel="Reports"
            className="h-[8.125rem] w-[8.125rem]"
          />

          <ul className="min-w-0 flex-1 space-y-2.5">
            {segments.map((segment) => (
              <li key={segment.id} className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={cn('h-2.5 w-2.5 shrink-0 rounded-full', segment.dotClass)}
                />
                <span className="min-w-0 flex-1 truncate text-[0.8rem] font-medium text-content dark:text-content-dark">
                  {segment.label}
                </span>
                <span className="shrink-0 text-[0.8rem] font-semibold text-content dark:text-content-dark">
                  {segment.value} ({segment.percent}%)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
