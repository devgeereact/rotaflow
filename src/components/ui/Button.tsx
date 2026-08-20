import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Variant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'success'
  | 'warning'
  | 'danger'
  // Outlined destructive. The "Revoke Access" treatment in
  // docs/design/SettingsOrganisation.png. A solid red button next to a neutral one
  // pulls the eye to the destructive choice; the outline keeps it legible as
  // dangerous without making it the visual default.
  | 'danger-outline';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

// `designsystem.png` shows six button styles: Primary, Secondary, Ghost,
// Success, Warning and Danger. Only the first three existed, so every
// destructive or confirming action in the app hand-rolled its own colours, // 43 elements carrying `bg-danger`/`text-danger` in a className, none of them
// agreeing on padding, weight or hover.
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary/90',
  secondary:
    'bg-surface text-content border border-surface-border hover:bg-surface-subtle ' +
    'dark:bg-surface-dark dark:text-content-dark dark:border-surface-border-dark dark:hover:bg-surface-subtle-dark',
  ghost:
    'bg-transparent text-primary hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark',
  success: 'bg-success text-white hover:bg-success/90',
  // `warning` is the one fill in the set that fails contrast against white at
  // its token value (#E0A030), so its ink is the dark content token rather
  // than white. Same swatch as the reference; readable text on it.
  warning: 'bg-warning text-content hover:bg-warning/90',
  danger: 'bg-danger text-white hover:bg-danger/90',
  'danger-outline':
    'bg-transparent text-danger border border-danger/40 hover:bg-danger/10',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-5 text-base',
  lg: 'h-12 px-6 text-base',
};

/** Design-system button. Meets the 44px touch-target minimum at md/lg. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold',
        'transition-transform duration-150 ease-in-out active:scale-[0.98] hover:scale-[1.02]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        // A disabled button must *look* disabled and must still be hoverable.
        //
        // `pointer-events-none` was doing real damage: a disabled `<button>`
        // already refuses clicks natively, so it prevented nothing, while
        // suppressing the hover that shows the `title` explaining *why* the
        // control is unavailable, and the `not-allowed` cursor that is the
        // only other signal. Every "why is nothing happening?" on this app's
        // disabled controls traces back to it.
        //
        // The opacity is deepened and hover growth suppressed as well: at
        // `opacity-50` a saturated primary button still reads as clickable,
        // which is how a disabled Create account button got mistaken for a
        // broken sign-up.
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100',
        'disabled:active:scale-100 disabled:saturate-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
