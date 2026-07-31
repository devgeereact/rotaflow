import { STATE_STROKE } from '@/lib/availabilityMatrix';
import type { AvailabilityBreakdown } from '@/lib/availabilityMatrix';

interface AvailabilityDonutProps {
  segments: AvailabilityBreakdown[];
  /** Two short lines inside the ring, e.g. "Next" / "7 days". */
  centreTop: string;
  centreBottom: string;
}

const SIZE = 88;
const STROKE = 13;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// 2px of surface between adjacent segments, per the dataviz mark spec — the
// reference shows the same hairline break between arcs.
const GAP = 2;

/**
 * Availability mix as a donut (design/Availability.png).
 *
 * These are the reserved *status* colours, not a categorical palette — the
 * segments are states (available / partially available / unavailable /
 * preference only / pending), so identity comes from the labelled legend beside
 * it and never from colour alone. Values and labels stay in text tokens; only
 * the swatch carries the hue.
 */
export function AvailabilityDonut({
  segments,
  centreTop,
  centreBottom,
}: AvailabilityDonutProps): JSX.Element {
  const total = segments.reduce((sum, s) => sum + s.percent, 0) || 100;
  let offset = 0;

  return (
    <div className="relative shrink-0">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={segments
          .map((s) => `${s.label} ${s.percent}%, ${s.count}`)
          .join('; ')}
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-divider dark:stroke-surface-subtle-dark"
        />
        {segments.map((segment) => {
          const length = (segment.percent / total) * CIRCUMFERENCE;
          const dash = Math.max(length - GAP, 0);
          const circle = (
            <circle
              key={segment.state}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              className={STATE_STROKE[segment.state]}
            />
          );
          offset += length;
          return circle;
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-xs font-semibold text-content dark:text-content-dark">
            {centreTop}
          </p>
          <p className="text-xs font-semibold text-content dark:text-content-dark">
            {centreBottom}
          </p>
        </div>
      </div>
    </div>
  );
}
