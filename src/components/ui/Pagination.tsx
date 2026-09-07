import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PaginationProps {
  /** 1-based. */
  page: number;
  pageCount: number;
  /** Rows matching the predicates, from the server. Never a page length. */
  total: number;
  /** 1-based index of the first and last row on screen. `0` when there are none. */
  from: number;
  to: number;
  onPageChange: (page: number) => void;
  /** What is being counted, lower case and plural: "organisations". */
  noun: string;
  className?: string;
}

/**
 * The page control for a list the server pages.
 *
 * ## Why the range line is the important half
 *
 * The console had no pagination at all. Every list rendered whatever array
 * came back and the tile above it printed that array's length as the total, so
 * a truncated response and a complete one looked identical. The buttons here
 * matter less than the sentence beside them: "Showing 21-40 of 137" is the
 * only thing on the screen that can distinguish "these are all of them" from
 * "these are the first twenty".
 *
 * `total` therefore comes from the server's count under the same predicates as
 * the rows, and is never derived from `rows.length`. The two agree only on the
 * last page.
 *
 * ## Accessibility
 *
 * The range is a live region, because on a keyboard the page buttons are the
 * only thing that moves — the table redraws silently, and without an
 * announcement a screen-reader user has no way to know the page changed. Both
 * buttons keep their accessible name when disabled rather than being removed,
 * so focus is not lost from under the person using them.
 */
export function Pagination({
  page,
  pageCount,
  total,
  from,
  to,
  onPageChange,
  noun,
  className,
}: PaginationProps): JSX.Element | null {
  // One page of results needs no control. The range line is still worth
  // showing when it is the only statement of how many there are, so the
  // caller renders that; this returns nothing rather than a dead widget.
  if (pageCount <= 1 && total <= to) return null;

  const button =
    'inline-flex h-9 items-center gap-1 rounded-lg border border-surface-border px-2.5 text-sm font-medium text-content transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-45 dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark';

  return (
    <nav
      aria-label={`${noun} pagination`}
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-divider px-3 py-2.5 dark:border-divider-dark',
        className,
      )}
    >
      <p
        aria-live="polite"
        className="text-sm text-content-muted dark:text-content-muted-dark"
      >
        {total === 0
          ? `No ${noun}`
          : `Showing ${from.toLocaleString('en-GB')}–${to.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} ${noun}`}
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className={button}
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft size={15} aria-hidden="true" />
          Previous
        </button>
        <span className="whitespace-nowrap text-sm text-content-muted dark:text-content-muted-dark">
          Page {page.toLocaleString('en-GB')} of {pageCount.toLocaleString('en-GB')}
        </span>
        <button
          type="button"
          className={button}
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
        >
          Next
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
