import type { LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>): JSX.Element {
  return (
    // eslint-disable-next-line jsx-a11y/label-has-associated-control -- htmlFor arrives via ...props, invisible to static analysis; every call site passes it.
    <label
      className={cn(
        'mb-1 block text-sm text-content-muted dark:text-content-muted-dark',
        className,
      )}
      {...props}
    />
  );
}
