import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PopoverProps {
  /**
   * The trigger. Receives the open state so a caret can rotate or an active
   * filter count can be shown; it is wrapped in the button, not replacing it.
   */
  label: ReactNode;
  /** Panel contents. Rendered only while open, so inputs mount fresh. */
  children: ReactNode;
  /** Accessible name when `label` is an icon or otherwise not descriptive. */
  ariaLabel?: string;
  className?: string;
  triggerClassName?: string;
  /** Panel alignment against the trigger. Defaults to right-aligned. */
  align?: 'left' | 'right';
  /** Panel width class. Defaults to `w-72`. */
  widthClassName?: string;
}

/**
 * A small click-outside/Escape-dismissed panel anchored to its trigger.
 *
 * Written because three screens each had a "Filters" or "Display settings"
 * button whose only behaviour was a toast reading "coming soon" — the exact
 * thing §24 of the build prompt forbids. A filter panel is a popover, not a
 * modal: it must not trap the page behind a scrim while someone compares the
 * grid against the filter they are choosing.
 *
 * Dismissal is bound on `pointerdown`, not `click`. A `click` listener fires
 * after the target's own handler, so clicking a second popover's trigger while
 * this one is open would close this and immediately reopen it — the panel
 * appears not to respond. `pointerdown` closes first, then the trigger runs.
 */
export function Popover({
  label,
  children,
  ariaLabel,
  className,
  triggerClassName,
  align = 'right',
  widthClassName = 'w-72',
}: PopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        // Return focus to the trigger, or the dismissal strands the keyboard
        // user at the top of the document.
        rootRef.current?.querySelector('button')?.focus();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={ariaLabel}
        className={triggerClassName}
      >
        {label}
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={ariaLabel}
          className={cn(
            'absolute top-full z-30 mt-2 rounded-xl border border-surface-border bg-surface p-4 shadow-lg',
            'dark:border-surface-border-dark dark:bg-surface-dark',
            align === 'right' ? 'right-0' : 'left-0',
            widthClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Section heading inside a popover panel. */
export function PopoverSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-muted dark:text-content-muted-dark">
        {title}
      </p>
      {children}
    </div>
  );
}

/** Labelled checkbox row, sized to the 44px touch target the prompt requires. */
export function PopoverCheckbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-content dark:text-content-dark">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-surface-border text-primary focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
      />
      {children}
    </label>
  );
}
