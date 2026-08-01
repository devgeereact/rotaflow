import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LeavePaginationProps {
  page: number;
  pageCount: number;
  /** 1-indexed range of rows currently shown, and the unfiltered total. */
  from: number;
  to: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const PAGE_SIZES = [10, 25, 50];

const STEP =
  'grid h-9 w-9 place-items-center rounded-xl border border-surface-border text-content-muted transition-colors hover:bg-surface-subtle disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark';

/**
 * Page numbers with an ellipsis once the run gets long: 1 2 3 … last.
 * Under five pages every number fits, so nothing is elided.
 */
function pageItems(page: number, pageCount: number): (number | 'gap')[] {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const around = [page - 1, page, page + 1].filter((n) => n > 1 && n < pageCount);
  const items: (number | 'gap')[] = [1];
  if (around[0] !== undefined && around[0] > 2) items.push('gap');
  items.push(...around);
  if (around[around.length - 1]! < pageCount - 1) items.push('gap');
  items.push(pageCount);
  return items;
}

/** Row-count summary, page steppers and page size (design/Leave.png). */
export function LeavePagination({
  page,
  pageCount,
  from,
  to,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: LeavePaginationProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-surface-border px-4 py-5 dark:border-surface-border-dark">
      <p className="text-[0.8rem] font-medium text-content-muted dark:text-content-muted-dark">
        Showing {from} to {to} of {total} requests
      </p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className={STEP}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        {pageItems(page, pageCount).map((item, index) =>
          item === 'gap' ? (
            <span
              key={`gap-${index}`}
              aria-hidden="true"
              className="grid h-9 w-9 place-items-center rounded-xl border border-surface-border text-[0.8rem] font-semibold text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark"
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              aria-label={`Page ${item}`}
              aria-current={item === page ? 'page' : undefined}
              className={cn(
                'grid h-9 w-9 place-items-center rounded-xl text-[0.8rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                item === page
                  ? 'bg-primary text-primary-fg'
                  : 'border border-surface-border text-content hover:bg-surface-subtle dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark',
              )}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
          aria-label="Next page"
          className={STEP}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center gap-2.5">
        <span className="text-[0.8rem] font-medium text-content-muted dark:text-content-muted-dark">
          Rows per page:
        </span>
        <div className="relative flex h-9 items-center rounded-xl border border-surface-border pl-3 pr-8 focus-within:ring-2 focus-within:ring-primary dark:border-surface-border-dark">
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label="Rows per page"
            className="appearance-none bg-transparent text-[0.8rem] font-semibold text-content outline-none dark:text-content-dark"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <ChevronDown
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 text-content-muted dark:text-content-muted-dark"
          />
        </div>
      </div>
    </div>
  );
}
