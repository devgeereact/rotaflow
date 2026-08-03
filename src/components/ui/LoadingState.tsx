import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

/**
 * One shimmering placeholder block.
 *
 * `animate-pulse` rather than a spinner: a spinner says "something is
 * happening", a skeleton says "something of roughly this shape is arriving",
 * and the second is what stops the page jumping when the data lands.
 */
export function Skeleton({ className }: { className?: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block animate-pulse rounded-md bg-surface-subtle',
        'dark:bg-surface-subtle-dark',
        className,
      )}
    />
  );
}

export interface LoadingStateProps {
  /**
   * `rows` sizes the skeleton to what is coming: a table of n rows, a grid of
   * n tiles, or n lines of text.
   */
  variant?: 'text' | 'table' | 'tiles' | 'card';
  rows?: number;
  /** Announced to screen readers in place of the visual shimmer. */
  label?: string;
  className?: string;
}

/**
 * The shared loading placeholder.
 *
 * ## Why this exists
 *
 * There were 31 hand-rolled `<p>Loading…</p>` blocks across the app, plus
 * `AdminLoading` in the platform console — audit01 P2-2, which notes that a
 * shared skeleton "would also fix the layout shift each one causes". A bare
 * "Loading…" line is one line tall; the table that replaces it is forty. Every
 * one of those screens visibly jumps.
 *
 * The live region matters as much as the shimmer: `aria-busy` with a polite
 * announcement is the only part of this a screen-reader user receives, since
 * the skeleton blocks themselves are `aria-hidden`.
 */
export function LoadingState({
  variant = 'text',
  rows = 3,
  label = 'Loading…',
  className,
}: LoadingStateProps): JSX.Element {
  const count = Math.max(1, rows);

  const body = (): JSX.Element => {
    switch (variant) {
      case 'table':
        return (
          <div className="space-y-2.5">
            <Skeleton className="h-9 w-full" />
            {Array.from({ length: count }, (_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        );
      case 'tiles':
        return (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: count }, (_, i) => (
              <Skeleton key={i} className="h-[6.5rem] w-full rounded-xl" />
            ))}
          </div>
        );
      case 'card':
        return (
          <div className="space-y-3">
            <Skeleton className="h-5 w-1/3" />
            {Array.from({ length: count }, (_, i) => (
              <Skeleton key={i} className="h-4 w-full last:w-2/3" />
            ))}
          </div>
        );
      default:
        return (
          <div className="space-y-2.5">
            {Array.from({ length: count }, (_, i) => (
              <Skeleton key={i} className="h-4 w-full last:w-1/2" />
            ))}
          </div>
        );
    }
  };

  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {body()}
    </div>
  );
}

/** `LoadingState` inside the standard surface, for a whole-panel wait. */
export function LoadingCard({
  variant = 'card',
  rows,
  label,
  className,
}: LoadingStateProps): JSX.Element {
  return (
    <Card className={className}>
      <LoadingState variant={variant} rows={rows} label={label} />
    </Card>
  );
}
