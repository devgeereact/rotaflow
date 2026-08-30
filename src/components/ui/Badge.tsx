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
  /**
   * Leading status dot, as the platform console reference draws it.
   *
   * Off by default: the org app also uses this component for *type* chips
   * (shift types, location types, plan names), and a dot on those reads as a
   * state they do not have. Turn it on where the chip really is a status.
   */
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Opaque washes, not `success/10`. See docs/DESIGN.md §2. The alpha versions
 * these replace resolved against whatever sat behind them, so the same pill
 * rendered as three different shades across a card, a table row and the canvas.
 */
// Light mode uses the `ink` tokens, dark mode keeps `DEFAULT`.
//
// Every `DEFAULT`-on-`wash` pair here failed WCAG AA: success 3.11:1, warning
// 2.04:1, danger 3.70:1, info 3.06:1, primary 3.36:1, against a 4.5:1 minimum
// for text this size. The `ink` tokens exist for exactly this and take the
// same pairs to 5.09-6.09:1. `wash-dark` is a dark background, so `DEFAULT`
// is already the high-contrast choice there and is left alone.
//
// This was a known open item (an app-wide contrast audit closed 63 of 84
// violations and left these) and it survived because the axe gate only covers
// public pages, where no Badge appeared until `/legal/trust`. The gate found
// it the moment one did.
const TONES: Record<BadgeTone, string> = {
  success: 'bg-success-wash text-success-ink dark:bg-success-wash-dark dark:text-success',
  warning: 'bg-warning-wash text-warning-ink dark:bg-warning-wash-dark dark:text-warning',
  danger: 'bg-danger-wash text-danger-ink dark:bg-danger-wash-dark dark:text-danger',
  info: 'bg-info-wash text-info-ink dark:bg-info-wash-dark dark:text-info',
  primary: 'bg-primary-wash text-primary-ink dark:bg-primary-wash-dark dark:text-primary',
  // Location / department type chips (docs/design/Locations-Management.png,
  // docs/design/Location-department.png) run across the shift palette, which is the
  // only token set with enough distinct hues for org-defined type lists. These
  // keep an alpha tint: the shift palette has no wash pair, and inventing eight
  // more tokens for chips that are already paired with a text label is not
  // worth the config.
  violet: 'bg-shift-violet/15 text-shift-violet',
  rose: 'bg-shift-rose/15 text-shift-rose',
  teal: 'bg-shift-teal/15 text-shift-teal',
  neutral:
    'border border-surface-border bg-surface-subtle text-content-muted dark:border-surface-border-dark dark:bg-surface-subtle-dark dark:text-content-muted-dark',
};

/**
 * Small status pill, "Published", "Live", "Pending" and the like.
 *
 * Status is never colour alone (docs/DESIGN.md §5): callers pass a label, and
 * an icon or `dot` where the reference shows one.
 */
export function Badge({
  tone = 'neutral',
  dot = false,
  children,
  className,
}: BadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[3px] text-[0.72rem] font-semibold',
        TONES[tone],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
        />
      )}
      {children}
    </span>
  );
}
