import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Label } from '@/components/ui/Label';
import { cn } from '@/lib/utils';

interface FieldProps {
  label: string;
  /**
   * The control. One element — an `Input`, `Select`, `textarea` or anything
   * that accepts `id` / `aria-describedby` / `aria-invalid` — cloned with the
   * wiring rather than asking every call site to repeat four ids.
   */
  children: ReactElement<{
    id?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
    required?: boolean;
    disabled?: boolean;
  }>;
  /** Persistent helper text. Shown whether or not the field is in error. */
  hint?: ReactNode;
  /** Inline validation message. Replaces nothing: it is added below the hint. */
  error?: string | null;
  required?: boolean;
  /**
   * Why the control is unavailable. A disabled field with no explanation is a
   * dead end — the person cannot tell whether it is broken, not yet relevant,
   * or something their role cannot change.
   */
  disabledReason?: string;
  className?: string;
}

/**
 * Label, hint and inline error around one control, wired for assistive tech.
 *
 * ## Why this exists
 *
 * Helper and error text were being placed by hand, and the placement varied:
 * some forms put the error above the field, some below, some replaced the hint
 * with it so the guidance disappeared exactly when it was most needed. Four of
 * the app's forms wired `aria-describedby`; the rest announced a red sentence
 * to nobody.
 *
 * The order is fixed here: label, control, hint, error. The hint stays visible
 * when an error appears, because "must be at least 8 characters" is the thing
 * that explains "Password is too short".
 *
 * ## Why it clones the child
 *
 * The alternative is a render prop handing back four ids, which every call
 * site then has to spread correctly, and the whole point is that they were not
 * being spread correctly. One element in, one wired element out.
 */
export function Field({
  label,
  children,
  hint,
  error,
  required = false,
  disabledReason,
  className,
}: FieldProps): JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const reasonId = `${id}-reason`;

  const describedBy =
    [hint ? hintId : null, error ? errorId : null, disabledReason ? reasonId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className={cn('min-w-0', className)}>
      {/* The shared `Label`, not a second one styled slightly differently.
          A form where the fields with hints look unlike the fields without is
          exactly the drift this component was added to remove. */}
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {cloneElement(children, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        required: required || children.props.required,
      })}
      {hint && (
        <p
          id={hintId}
          className="mt-1.5 text-xs text-content-muted dark:text-content-muted-dark"
        >
          {hint}
        </p>
      )}
      {disabledReason && (
        <p
          id={reasonId}
          className="mt-1.5 text-xs text-content-muted dark:text-content-muted-dark"
        >
          {disabledReason}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-danger-ink dark:text-danger-ink-dark"
        >
          <AlertCircle size={14} aria-hidden="true" className="mt-px shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
