import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StaffSectionHeaderProps {
  title: string;
  /** Right-hand text affordance — "View all", "Edit", "View calendar". */
  action?: ReactNode;
  className?: string;
}

/** Card/section title with an optional right-aligned link, used across both staff screens. */
export function StaffSectionHeader({
  title,
  action,
  className,
}: StaffSectionHeaderProps): JSX.Element {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      {/* 14px, not `text-card-heading` — measured off both references, where the
          card titles sit at roughly half the 30px page title. */}
      <h2 className="truncate text-sm font-semibold text-content dark:text-content-dark">
        {title}
      </h2>
      {action && <span className="shrink-0">{action}</span>}
    </div>
  );
}
