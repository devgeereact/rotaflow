import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ScrollRegionProps {
  /** Names the region for a screen reader, and labels the visible cue. */
  label: string;
  children: ReactNode;
  className?: string;
  /** Class for the scrolling element itself, e.g. a `max-h-*`. */
  viewportClassName?: string;
}

/**
 * A horizontally scrolling area that says so.
 *
 * ## Why this exists
 *
 * `overflow-x-auto` on a bare `div` produces three separate problems, and the
 * app had all three. A pointer user can drag the area sideways, so nobody
 * building it notices; a keyboard user cannot scroll a plain `div` at all, so
 * every column past the fold is simply unreachable; and on a phone there is no
 * indication that anything is out there, so the Team directory looked like a
 * two-column table rather than a seven-column one with five columns hidden
 * (`docs/design-review/team-mobile.png`).
 *
 * `DataTable` already solved the first two for itself with `tabIndex={0}` and
 * `role="region"`. This generalises that and adds the missing third: a fade at
 * the scrolled edge and a short line naming the gesture, both shown **only
 * while the content actually overflows**, so a table that fits carries no
 * furniture.
 *
 * The overflow is measured, not guessed at a breakpoint. Whether a table
 * overflows depends on its content — a long site name, a 200% zoom, a German
 * label — and a `md:hidden` cue is wrong in both directions.
 */
export function ScrollRegion({
  label,
  children,
  className,
  viewportClassName,
}: ScrollRegionProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  const measure = useCallback((): void => {
    const el = ref.current;
    if (!el) return;
    const over = el.scrollWidth > el.clientWidth + 1;
    setOverflowing(over);
    setAtEnd(!over || el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    // `ResizeObserver` catches the viewport changing AND the content changing,
    // which a window `resize` listener does not: a filter that removes rows can
    // change the widest cell.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measure, children]);

  return (
    <div className={cn('relative', className)}>
      <div
        ref={ref}
        onScroll={measure}
        className={cn('overflow-x-auto', viewportClassName)}
        // A scrollable region is the documented exception to the
        // no-noninteractive-tabindex rule — it is not interactive, and it must
        // still be reachable by keyboard, which is why the rule's own `roles`
        // option lists `region`.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        role="region"
        aria-label={label}
      >
        {children}
      </div>
      {overflowing && (
        <>
          {/* Decorative edge fade. `aria-hidden`, and it never covers a
              control: it sits over the last 24px of a scrolling area whose
              content continues past it either way. */}
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-y-0 right-0 w-6 rounded-r-lg',
              'bg-gradient-to-l from-surface to-transparent dark:from-surface-dark',
              'transition-opacity duration-control motion-reduce:transition-none',
              atEnd && 'opacity-0',
            )}
          />
          <p className="mt-1.5 px-4 text-xs text-content-muted dark:text-content-muted-dark">
            {label} scrolls sideways for more columns.
          </p>
        </>
      )}
    </div>
  );
}
