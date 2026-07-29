import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none',
        'focus-visible:ring-2 focus-visible:ring-primary',
        'dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
