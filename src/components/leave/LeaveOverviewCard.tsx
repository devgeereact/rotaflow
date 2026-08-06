import { ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import { LEAVE_TYPE_DOT, LEAVE_TYPE_STROKE } from '@/lib/leaveStatus';
import type { LeaveTypeCount } from '@/lib/leaveRows';

interface LeaveOverviewCardProps {
  counts: LeaveTypeCount[];
  /** Pre-formatted range label for the selector, e.g. "This Year". */
  rangeLabel: string;
  onRangeClick: () => void;
}

const SIZE = 117;
const STROKE = 16;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// A 2px surface gap between adjacent segments, per the dataviz mark spec, // without it neighbouring arcs read as one continuous band.
const GAP = 2;

/**
 * Days taken per leave type as a donut plus a labelled legend
 * (design/Leave.png).
 *
 * The arc carries no meaning on its own: every segment is named, counted and
 * percentaged in the legend beside it, so the chart is readable without colour
 * vision (docs/DESIGN.md §5).
 */
export function LeaveOverviewCard({
  counts,
  rangeLabel,
  onRangeClick,
}: LeaveOverviewCardProps): JSX.Element {
  const total = counts.reduce((sum, entry) => sum + entry.days, 0);

  let offset = 0;
  const segments = counts
    .filter((entry) => entry.days > 0)
    .map((entry) => {
      const fraction = total === 0 ? 0 : entry.days / total;
      const length = Math.max(0, CIRCUMFERENCE * fraction - GAP);
      const segment = { ...entry, length, offset };
      offset += CIRCUMFERENCE * fraction;
      return segment;
    });

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[0.95rem] font-bold text-content dark:text-content-dark">
          Leave Overview
        </h2>
        <button
          type="button"
          onClick={onRangeClick}
          className="flex h-8 items-center gap-1.5 rounded-xl border border-surface-border px-2.5 text-[0.8rem] font-semibold text-content transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
        >
          {rangeLabel}
          <ChevronDown
            size={14}
            aria-hidden="true"
            className="text-content-muted dark:text-content-muted-dark"
          />
        </button>
      </div>

      <div className="flex items-center gap-3">
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
                key={segment.type}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                strokeWidth={STROKE}
                strokeDasharray={`${segment.length} ${CIRCUMFERENCE - segment.length}`}
                strokeDashoffset={-segment.offset}
                transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                className={LEAVE_TYPE_STROKE[segment.type]}
              />
            ))}
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <p className="text-[1.4rem] font-bold leading-7 text-content dark:text-content-dark">
                {total}
              </p>
              <p className="text-[0.72rem] leading-4 text-content-muted dark:text-content-muted-dark">
                Days Taken
              </p>
            </div>
          </div>
        </div>

        <ul className="min-w-0 flex-1 space-y-2">
          {counts.map((entry) => (
            <li key={entry.type} className="flex items-center gap-2 text-[0.72rem]">
              <span
                aria-hidden="true"
                className={cn(
                  'h-2.5 w-2.5 shrink-0 rounded-full',
                  LEAVE_TYPE_DOT[entry.type],
                )}
              />
              <span className="min-w-0 flex-1 truncate font-semibold text-content dark:text-content-dark">
                {entry.label}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-content dark:text-content-dark">
                {entry.days} days{' '}
                {total > 0 && `(${Math.round((entry.days / total) * 100)}%)`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
