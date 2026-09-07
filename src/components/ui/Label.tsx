import type { LabelHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /**
   * Marks the field as required, visibly and to a screen reader.
   *
   * The asterisk alone is not a label: it is `aria-hidden`, and the words
   * "(required)" are what actually reach assistive technology. Forms across
   * this app marked required fields with nothing at all, or with an asterisk
   * that announced as "star".
   */
  required?: boolean;
  children?: ReactNode;
}

/**
 * The one form-label style. `ui/Field` renders this rather than a second copy,
 * so a field with a hint and a field without cannot end up looking different.
 */
export function Label({
  className,
  required = false,
  children,
  ...props
}: LabelProps): JSX.Element {
  return (
    // The rule is satisfied now that this element has children: `htmlFor`
    // still arrives via `...props` and is invisible to static analysis, but the
    // nested text is enough for the check.
    <label
      className={cn(
        'mb-1 block text-sm text-content-muted dark:text-content-muted-dark',
        className,
      )}
      {...props}
    >
      {children}
      {required && (
        <span className="ml-1 text-danger-ink dark:text-danger-ink-dark">
          <span aria-hidden="true">*</span>
          <span className="sr-only">(required)</span>
        </span>
      )}
    </label>
  );
}
