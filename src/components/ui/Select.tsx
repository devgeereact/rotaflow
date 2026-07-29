import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none',
        'focus-visible:ring-2 focus-visible:ring-primary',
        'dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
