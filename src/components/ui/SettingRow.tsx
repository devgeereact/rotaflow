import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SettingRowProps {
  label: string;
  /** One line saying what changes, and for whom. */
  hint?: ReactNode;
  /** The control, or a value where the setting is read-only. */
  control: ReactNode;
  /** Drop the separator on the last row of a group. */
  last?: boolean;
  className?: string;
}

/**
 * One configurable thing: what it is on the left, what it is set to on the
 * right.
 *
 * The console reference lays every settings tab out this way rather than as a
 * form of stacked labelled inputs, and the reason is scanning. A settings tab
 * is read far more often than it is edited — "is registration open on prod?" —
 * and a column of controls at a predictable right edge answers that in one
 * pass, where labels above inputs make the reader zig-zag.
 *
 * `hint` is not decoration here. Most of these settings do something
 * non-obvious to people who are not looking at the screen, and the row is the
 * only place to say so.
 */
export function SettingRow({
  label,
  hint,
  control,
  last = false,
  className,
}: SettingRowProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start gap-x-4 gap-y-2 py-3.5',
        !last && 'border-b border-divider dark:border-divider-dark',
        className,
      )}
    >
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-sm font-semibold text-content dark:text-content-dark">
          {label}
        </p>
        {hint && (
          <p className="mt-0.5 max-w-[56ch] text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
            {hint}
          </p>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">{control}</div>
    </div>
  );
}
