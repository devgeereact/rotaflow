import type { LucideIcon } from 'lucide-react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StepRingState = 'done' | 'active' | 'pending';

interface StepRingProps {
  icon: LucideIcon;
  state: StepRingState;
  /** Accessible name for the icon; the ring has no visible label of its own. */
  label: string;
  className?: string;
}

const SIZE = 96;
const STROKE = 4;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Fixed decorative sweep for the 'active' state (design/appboot.png measures
// ~144° / 40% on its one active stage). There is no per-stage progress signal
// to drive this precisely, so every active step uses the same sweep — it
// reads as "in motion", not a literal percentage.
const ACTIVE_SWEEP = 0.4;

/**
 * The circular step indicator in the app-boot stage tracker
 * (design/appboot.png): an icon inside a ring whose state reads at a glance —
 * a uniform tinted ring for done/pending, a partial sweep for the step
 * currently running, and a checkmark badge once a step completes.
 */
export function StepRing({ icon: Icon, state, label, className }: StepRingProps): JSX.Element {
  return (
    <span className={cn('relative inline-grid shrink-0 place-items-center', className)}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          fill="none"
          className={cn(
            state === 'done' && 'stroke-brand-mist dark:stroke-brand-deep/40',
            state === 'active' && 'stroke-brand-wash dark:stroke-surface-border-dark',
            state === 'pending' && 'stroke-surface-border dark:stroke-surface-border-dark',
          )}
        />
        {state === 'active' && (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - ACTIVE_SWEEP)}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            className="stroke-brand"
          />
        )}
      </svg>
      <span
        className={cn(
          'absolute inset-0 grid place-items-center',
          state === 'pending' ? 'text-brand-faint' : 'text-brand',
        )}
      >
        <Icon size={28} aria-label={label} />
      </span>
      {state === 'done' && (
        <span className="absolute -right-0.5 -top-0.5 grid h-6 w-6 place-items-center rounded-full bg-success text-white ring-2 ring-background dark:ring-background-dark">
          <Check size={14} aria-hidden="true" />
        </span>
      )}
    </span>
  );
}
