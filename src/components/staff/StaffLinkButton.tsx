import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StaffLinkButtonProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}

/**
 * The small blue text affordance both staff screens use for "View all",
 * "Edit", "View calendar" and "View timesheet".
 */
export function StaffLinkButton({
  children,
  onClick,
  className,
}: StaffLinkButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded text-sm font-semibold text-primary',
        'hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        className,
      )}
    >
      {children}
    </button>
  );
}
