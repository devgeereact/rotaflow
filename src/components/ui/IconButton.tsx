import { forwardRef, type ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CONTROL_MOTION } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

type IconButtonSize = 'sm' | 'md';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /**
   * Required. An icon-only control has no accessible name otherwise, and
   * `title` alone does not give one to a screen reader.
   */
  label: string;
  /**
   * `md` (44×44) is the default and the only size allowed for a control a
   * person is expected to hit on a phone — a dialog close, a menu trigger, a
   * period stepper. `sm` (36×36) is under the product's 44px target and exists
   * only for controls inside a dense table row, where a 44px button changes
   * the row height and therefore the screen.
   */
  size?: IconButtonSize;
  /** Icon glyph size. Defaults to 20 (`md`) / 16 (`sm`), per docs/DESIGN.md §3. */
  iconSize?: number;
}

const SIZES: Record<IconButtonSize, { box: string; glyph: number }> = {
  // `h-11 w-11` is 44px exactly — the product target in docs/DESIGN.md §5,
  // which is stricter than WCAG 2.2 AA's 24px minimum on purpose.
  md: { box: 'h-11 w-11', glyph: 20 },
  sm: { box: 'h-9 w-9', glyph: 16 },
};

/**
 * A square, icon-only control with a real hit area.
 *
 * ## Why this exists
 *
 * Icon-only buttons were being written inline, and each one re-decided its own
 * padding. The dialog close was the clearest case: `p-1` around an 18px icon
 * is a 26×26 target, on the control every modal in the product depends on, and
 * the one a person reaches for one-handed. `aria-label` was remembered most of
 * the time but not by contract.
 *
 * This is deliberately not a `Button` variant. `Button` sizes by height and
 * horizontal padding around a label; an icon button is a square with no label,
 * and expressing that through `size="md" className="w-11 px-0"` at every call
 * site is how the padding drifted in the first place.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    { icon: Icon, label, size = 'md', iconSize, type = 'button', className, ...props },
    ref,
  ) => {
    const { box, glyph } = SIZES[size];
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-lg',
          'text-content-muted hover:bg-surface-subtle hover:text-content',
          'dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark dark:hover:text-content-dark',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          'disabled:cursor-not-allowed disabled:opacity-40',
          CONTROL_MOTION,
          box,
          className,
        )}
        {...props}
      >
        <Icon size={iconSize ?? glyph} aria-hidden="true" />
      </button>
    );
  },
);
IconButton.displayName = 'IconButton';
