import { cn } from '@/lib/utils';

interface CoverageRingProps {
  /** 0-100. */
  value: number;
  className?: string;
}

const SIZE = 26;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The small coverage donut beside "N / M Staff" in the shift-details panel
 * (docs/design/published-schedule.png). Decorative. The percentage is always
 * spelled out next to it, so the ring is `aria-hidden`.
 */
export function CoverageRing({ value, className }: CoverageRingProps): JSX.Element {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        strokeWidth={STROKE}
        fill="none"
        className="stroke-divider dark:stroke-surface-border-dark"
      />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - clamped / 100)}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        className={clamped >= 80 ? 'stroke-success' : 'stroke-warning'}
      />
    </svg>
  );
}
