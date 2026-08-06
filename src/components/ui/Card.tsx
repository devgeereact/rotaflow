import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Surface container with the standard border + radius tokens. */
export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn(
        'rounded-2xl border border-surface-border bg-surface p-6 shadow-sm',
        'dark:border-surface-border-dark dark:bg-surface-dark',
        className,
      )}
      {...props}
    />
  );
}

interface PanelProps {
  /** Rendered as the panel's own heading. Omit for a headerless panel. */
  title?: ReactNode;
  /** Right-aligned header slot, a filter, a badge, a "View all" link. */
  actions?: ReactNode;
  /** Drop the body padding for a panel whose child is a full-bleed table. */
  flush?: boolean;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/**
 * A `Card` with the console's titled header.
 *
 * `Card` is the bare surface and stays that way. Around fifty screens render
 * one and its `p-6` is what their reference PNGs show. This is the other shape,
 * from `docs/PLATFORM_CONSOLE.html`: a divider-separated header strip with the
 * heading on the left and one control on the right, over a tighter body. It is
 * a separate component rather than more props on `Card` so that neither
 * treatment can drift into the other by accident.
 *
 * `flush` exists because the most common panel body is a `DataTable`, which
 * brings its own cell padding. Nesting it in a padded body insets the table
 * from its own header rule and looks like a mistake.
 */
export function Panel({
  title,
  actions,
  flush = false,
  children,
  className,
  bodyClassName,
}: PanelProps): JSX.Element {
  return (
    <Card className={cn('p-0', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center gap-2.5 border-b border-divider px-4 py-3.5 dark:border-divider-dark">
          {title && (
            <h3 className="text-card-heading font-semibold text-content dark:text-content-dark">
              {title}
            </h3>
          )}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(!flush && 'p-4', bodyClassName)}>{children}</div>
    </Card>
  );
}
