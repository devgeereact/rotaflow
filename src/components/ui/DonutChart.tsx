import { cn } from '@/lib/utils';

export interface DonutSegment {
  id: string;
  label: string;
  value: number;
  /** A Tailwind `stroke-*` token class, e.g. `stroke-success`. */
  strokeClass: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  /** Rendered large in the hole; falls back to the summed value. */
  centreValue?: string;
  centreLabel: string;
  className?: string;
}

// Geometry in viewBox units: a 100-wide box, a ring centred on r = 43.4 drawn
// 13.3 units thick, which reproduces the reference's 113px donut with a 15px
// ring. GAP is the hairline of canvas the reference leaves between segments.
const RADIUS = 43.4;
const THICKNESS = 13.3;
const GAP = 1.6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Proportional ring with a value in the hole. The Reports Overview breakdown
 * (docs/design/Reports-Dashboard.png). Purely presentational: the legend beside it
 * carries the numbers, so the ring is labelled for assistive tech and never
 * asks anyone to read a value off the colour.
 */
export function DonutChart({
  segments,
  centreValue,
  centreLabel,
  className,
}: DonutChartProps): JSX.Element {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  let offset = 0;

  return (
    <div className={cn('relative shrink-0', className)}>
      <svg
        viewBox="0 0 100 100"
        className="h-full w-full -rotate-90"
        role="img"
        aria-label={segments
          .map((segment) => `${segment.label}: ${segment.value}`)
          .join(', ')}
      >
        {total === 0 ? (
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            strokeWidth={THICKNESS}
            className="stroke-divider dark:stroke-surface-subtle-dark"
          />
        ) : (
          segments
            .filter((segment) => segment.value > 0)
            .map((segment) => {
              const length = (segment.value / total) * CIRCUMFERENCE;
              const dash = Math.max(length - GAP, 0.5);
              const node = (
                <circle
                  key={segment.id}
                  cx="50"
                  cy="50"
                  r={RADIUS}
                  fill="none"
                  strokeWidth={THICKNESS}
                  strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                  strokeDashoffset={-offset}
                  className={segment.strokeClass}
                />
              );
              offset += length;
              return node;
            })
        )}
      </svg>

      <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
        <p className="font-display text-2xl font-bold leading-7 text-content dark:text-content-dark">
          {centreValue ?? total}
        </p>
        <p className="text-[0.72rem] leading-4 text-content-muted dark:text-content-muted-dark">
          {centreLabel}
        </p>
      </div>
    </div>
  );
}
