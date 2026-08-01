import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimesheetPaginationProps {
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
  'grid h-7 w-7 place-items-center rounded-lg border border-surface-border text-content-muted transition-colors hover:bg-surface-subtle disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark';

/** Row-count summary, page steppers and page size (design/Timesheets-Dashboard.png). */
export function TimesheetPagination({
  page,
  pageCount,
  from,
  to,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: TimesheetPaginationProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-surface-border px-3.5 py-1 dark:border-surface-border-dark">
      <p className="text-[0.72rem] text-content-muted dark:text-content-muted-dark">
        Showing {from} to {to} of {total} timesheets
      </p>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className={STEP}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
          <button
            key={number}
            type="button"
            onClick={() => onPageChange(number)}
            aria-label={`Page ${number}`}
            aria-current={number === page ? 'page' : undefined}
            className={cn(
              'grid h-7 w-7 place-items-center rounded-lg text-[0.72rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              number === page
                ? 'bg-primary text-primary-fg'
                : 'border border-surface-border text-content hover:bg-surface-subtle dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark',
            )}
          >
            {number}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
          aria-label="Next page"
          className={STEP}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[0.72rem] text-content-muted dark:text-content-muted-dark">
          Rows per page:
        </span>
        <div className="relative flex h-7 items-center rounded-lg border border-surface-border pl-2.5 pr-8 focus-within:ring-2 focus-within:ring-primary dark:border-surface-border-dark">
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label="Rows per page"
            className="appearance-none bg-transparent text-[0.72rem] font-semibold text-content outline-none dark:text-content-dark"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <ChevronDown
            size={13}
            aria-hidden="true"
            className="pointer-events-none absolute right-2 text-content-muted dark:text-content-muted-dark"
          />
        </div>
      </div>
    </div>
  );
}
