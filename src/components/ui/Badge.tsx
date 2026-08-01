import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'primary'
  | 'violet'
  | 'rose'
  | 'teal'
  | 'neutral';

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

const TONES: Record<BadgeTone, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-info/10 text-info',
  primary: 'bg-primary/10 text-primary',
  // Location / department type chips (design/Locations-Management.png,
  // design/Location-department.png) run across the shift palette, which is the
  // only token set with enough distinct hues for org-defined type lists.
  violet: 'bg-shift-violet/15 text-shift-violet',
  rose: 'bg-shift-rose/15 text-shift-rose',
  teal: 'bg-shift-teal/15 text-shift-teal',
  neutral:
    'bg-divider text-content-muted dark:bg-surface-subtle-dark dark:text-content-muted-dark',
};

/**
 * Small status pill — "Published", "Live", "Pending" and the like.
 *
 * Status is never colour alone (docs/DESIGN.md §5): callers pass a label, and
 * an icon where the reference shows one.
 */
export function Badge({
  tone = 'neutral',
  children,
  className,
}: BadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
