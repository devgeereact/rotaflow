import { ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import { SWAP_STATUS_DOT, SWAP_STATUS_STROKE } from '@/lib/swapRows';
import type { SwapStatusCount } from '@/lib/swapRows';

interface SwapOverviewCardProps {
  counts: SwapStatusCount[];
  /** Pre-formatted range label for the selector, e.g. "This Week". */
  rangeLabel: string;
  onRangeClick: () => void;
}

const SIZE = 104;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// A 2px surface gap between adjacent segments — without it neighbouring arcs
// read as one continuous band.
const GAP = 2;

/**
 * Request mix as a donut plus a labelled legend (design/Swap-Request.png).
 *
 * The arc carries no meaning on its own: every segment is named, counted and
 * percentaged in the legend beside it, so the chart is readable without colour
 * vision (docs/DESIGN.md §5).
 */
export function SwapOverviewCard({
  counts,
  rangeLabel,
  onRangeClick,
}: SwapOverviewCardProps): JSX.Element {
  const total = counts.reduce((sum, entry) => sum + entry.count, 0);

  let offset = 0;
  const segments = counts
    .filter((entry) => entry.count > 0)
    .map((entry) => {
      const fraction = total === 0 ? 0 : entry.count / total;
      const length = Math.max(0, CIRCUMFERENCE * fraction - GAP);
      const segment = { ...entry, length, offset };
      offset += CIRCUMFERENCE * fraction;
      return segment;
    });

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[0.9rem] font-semibold text-content dark:text-content-dark">
          Swap Overview
        </h2>
        <button
          type="button"
          onClick={onRangeClick}
          className="flex h-7 items-center gap-2 rounded-lg border border-surface-border px-2.5 text-[0.72rem] font-semibold text-content transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
        >
          {rangeLabel}
          <ChevronDown
            size={14}
            aria-hidden="true"
            className="text-content-muted dark:text-content-muted-dark"
          />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative shrink-0">
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            aria-hidden="true"
          >
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              className="stroke-divider dark:stroke-surface-subtle-dark"
            />
            {segments.map((segment) => (
              <circle
                key={segment.status}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                strokeWidth={STROKE}
                strokeDasharray={`${segment.length} ${CIRCUMFERENCE - segment.length}`}
                strokeDashoffset={-segment.offset}
                transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                className={SWAP_STATUS_STROKE[segment.status]}
              />
            ))}
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <p className="text-[1.25rem] font-bold leading-6 text-content dark:text-content-dark">
                {total}
              </p>
              <p className="text-[0.62rem] leading-4 text-content-muted dark:text-content-muted-dark">
                Total Requests
              </p>
            </div>
          </div>
        </div>

        <ul className="min-w-0 flex-1 space-y-2.5">
          {counts.map((entry) => (
            <li key={entry.status} className="flex items-center gap-2 text-[0.66rem]">
              <span
                aria-hidden="true"
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  SWAP_STATUS_DOT[entry.status],
                )}
              />
              <span className="min-w-0 flex-1 truncate font-semibold text-content dark:text-content-dark">
                {entry.label}
              </span>
              <span className="shrink-0 tabular-nums text-content-muted dark:text-content-muted-dark">
                {entry.count}
                {total > 0 && ` (${Math.round((entry.count / total) * 100)}%)`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
