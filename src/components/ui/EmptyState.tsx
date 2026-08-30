import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  /** Say what to do next, not just that the list is empty. */
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * The "nothing here yet" panel.
 *
 * Thirteen screens hand-rolled this, most as a bare centred sentence
 * ("No documents on file yet."). An empty list is the single most common
 * first-run state in a scheduling app, a new organisation sees it on almost
 * every screen, so it is worth one component that reliably tells the user
 * what to do next rather than only that there is nothing to see.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): JSX.Element {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {Icon && (
        <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary dark:text-primary-ink-dark">
          <Icon size={22} aria-hidden="true" />
        </span>
      )}
      <p className="text-card-heading font-semibold text-content dark:text-content-dark">
        {title}
      </p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-content-muted dark:text-content-muted-dark">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
