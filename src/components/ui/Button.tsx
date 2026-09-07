import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Variant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'success'
  | 'warning'
  | 'danger'
  // The attendance CTA, and the only place the `clock` palette is a button
  // fill. It is a deliberate exception to "primary blue means action": on the
  // clock-in screen there is exactly one thing to do and it is not a
  // navigation, and the reference (docs/design/clockin.png) draws it green.
  // Kept as a variant rather than a className so the exception is countable —
  // one variant, used twice, instead of a green button anybody can hand-roll.
  | 'clock'
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
  // `text-primary` is a FILL colour: #3B6FE0 as text on `surface` measures
  // 4.08:1, under the 4.5:1 AA minimum, and `ghost` is the one variant whose
  // colour *is* its label. The dark half was already using the ink pair; the
  // light half was not, which is the exact half-applied pattern
  // docs/DESIGN.md §5 warns about.
  ghost:
    'bg-transparent text-primary-ink dark:text-primary-ink-dark hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark',
  success: 'bg-success text-white hover:bg-success/90',
  // `warning` is the one fill in the set that fails contrast against white at
  // its token value (#E0A030), so its ink is the dark content token rather
  // than white. Same swatch as the reference; readable text on it.
  warning: 'bg-warning text-content hover:bg-warning/90',
  danger: 'bg-danger text-white hover:bg-danger/90',
  clock:
    'bg-clock text-primary-fg hover:bg-clock/90 focus-visible:ring-clock focus-visible:ring-offset-2',
  'danger-outline':
    'bg-transparent text-danger border border-danger/40 hover:bg-danger/10',
};

const SIZES: Record<Size, string> = {
  // 36px tall, under the 44px product target. It stays, because a dense table
  // row cannot carry a 44px control without becoming a different table — but
  // it is for controls inside dense content only, never for a page action, and
  // an icon-only control at this size must use `IconButton` instead.
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-5 text-base',
  lg: 'h-12 px-6 text-base',
};

/**
 * The motion contract shared by every control in the product.
 *
 * Two changes from what Button carried before. `transition-transform` moved to
 * an explicit property list that includes the colours a hover actually
 * changes — the hover fill used to snap while only the scale eased. And the
 * transforms are removed under `prefers-reduced-motion`.
 *
 * The global rule in `src/index.css` collapses every *duration* to ~0 under
 * that preference, which is necessary and not sufficient: a `scale(1.02)` with
 * no transition still scales, just instantly. `motion-reduce:` is what removes
 * the transform itself. docs/DESIGN.md §4.
 */
export const CONTROL_MOTION =
  'transition-[transform,background-color,border-color,color,box-shadow] duration-control ease-in-out ' +
  'motion-reduce:transition-none motion-reduce:transform-none';

/** Design-system button. Meets the 44px touch-target minimum at md/lg. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  // `type` defaults to 'button', not the HTML default of 'submit'.
  //
  // A <button> with no type inside a <form> submits it. That is the classic
  // way a Cancel button becomes a second Save, and it was a live hazard here
  // the moment the auth screens gained real <form> elements: the magic-link
  // button and the show-password toggle sit inside the same form as Sign in.
  // Every existing caller inside a form already states its own type, so this
  // default changes nothing that works today and removes a trap from
  // everything written next. A submit button says `type="submit"` out loud.
  ({ variant = 'primary', size = 'md', type = 'button', className, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold',
        CONTROL_MOTION,
        'active:scale-[0.98] hover:scale-[1.02]',
        'motion-reduce:hover:scale-100 motion-reduce:active:scale-100',
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
