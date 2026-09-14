import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Leading icon, e.g. `Mail`. Rendered inside the field, never as a separate label. */
  icon?: LucideIcon;
  /** Trailing slot, e.g. a password show/hide toggle button. */
  endAdornment?: ReactNode;
  /** Wrapper class, for when the icon/adornment wrapper needs layout classes instead of the input itself. */
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, wrapperClassName, icon: Icon, endAdornment, ...props }, ref) => {
    const field = (
      <input
        ref={ref}
        className={cn(
          'w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none',
          'placeholder:text-content-muted focus-visible:ring-2 focus-visible:ring-primary',
          'dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark',
          Icon && 'pl-10',
          // 48px: the adornment is a 44x44 control (docs/DESIGN.md §5) sat 4px
          // in from the edge, and text must not run underneath it.
          endAdornment && 'pr-12',
          className,
        )}
        {...props}
      />
    );

    if (!Icon && !endAdornment) return field;

    return (
      <div className={cn('relative', wrapperClassName)}>
        {Icon && (
          <Icon
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted"
          />
        )}
        {field}
        {endAdornment && (
          <div className="absolute right-1 top-1/2 -translate-y-1/2">{endAdornment}</div>
        )}
      </div>
    );
  },
);
Input.displayName = 'Input';
