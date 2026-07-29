import type { LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>): JSX.Element {
  return (
    <label
      className={cn(
        'mb-1 block text-sm text-content-muted dark:text-content-muted-dark',
        className,
      )}
      {...props}
    />
  );
}
