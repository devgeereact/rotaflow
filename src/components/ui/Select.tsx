import { forwardRef, type SelectHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Leading icon, e.g. `Briefcase`. Rendered inside the field. */
  icon?: LucideIcon;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, icon: Icon, ...props }, ref) => (
    <div className="relative">
      {Icon && (
        <Icon
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted"
        />
      )}
      <select
        ref={ref}
        className={cn(
          'w-full appearance-none rounded-xl border border-surface-border bg-background px-3 py-2.5 pr-10 text-content outline-none',
          'focus-visible:ring-2 focus-visible:ring-primary',
          'dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark',
          Icon && 'pl-10',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-content-muted"
      />
    </div>
  ),
);
Select.displayName = 'Select';
