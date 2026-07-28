import type { HTMLAttributes } from 'react';
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
        className,
      )}
      {...props}
    />
  );
}
