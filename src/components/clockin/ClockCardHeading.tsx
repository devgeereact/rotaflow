import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ClockCardHeadingProps {
  icon: LucideIcon;
  title: string;
  /** Optional trailing affordance — a "View All"-style link in the reference. */
  action?: ReactNode;
  className?: string;
}

/**
 * The tinted-icon + title row every card on design/clockin.png opens with.
 * Extracted because seven cards repeat it exactly; the only variation is the
 * trailing link.
 */
export function ClockCardHeading({
  icon: Icon,
  title,
  action,
  className,
}: ClockCardHeadingProps): JSX.Element {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary dark:bg-primary/15">
          <Icon size={16} aria-hidden="true" />
        </span>
        <h2 className="text-card-heading font-semibold text-content dark:text-content-dark">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}
