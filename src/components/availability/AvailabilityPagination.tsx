import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AvailabilityPaginationProps {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const PAGE_BUTTON =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/**
 * Builds the page list with a single ellipsis before the last page, matching
 * the reference's "1 2 3 … 6".
 */
function pageItems(page: number, pageCount: number): (number | 'gap')[] {
  if (pageCount <= 4) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const head = [1, 2, 3].filter((n) => n <= pageCount);
  const items: (number | 'gap')[] = [...head];
  if (page > 3 && page < pageCount) items.push('gap', page);
  else items.push('gap');
  items.push(pageCount);
  return items;
}

/** Row count, pager and page-size control beneath the matrix. */
export function AvailabilityPagination({
  page,
  pageCount,
  from,
  to,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: AvailabilityPaginationProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-border px-5 py-3 dark:border-surface-border-dark">
      <p className="text-sm text-content-muted dark:text-content-muted-dark">
        Showing {from} to {to} of {total} staff
      </p>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className={cn(
            PAGE_BUTTON,
            'border border-surface-border text-content disabled:opacity-40 dark:border-surface-border-dark dark:text-content-dark',
          )}
        >
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        {pageItems(page, pageCount).map((item, index) =>
          item === 'gap' ? (
            <span
              key={`gap-${index}`}
              className="px-1 text-sm text-content-muted dark:text-content-muted-dark"
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              aria-current={item === page ? 'page' : undefined}
              onClick={() => onPageChange(item)}
              className={cn(
                PAGE_BUTTON,
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
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          className={cn(
            PAGE_BUTTON,
            'border border-surface-border text-content disabled:opacity-40 dark:border-surface-border-dark dark:text-content-dark',
          )}
        >
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm text-content-muted dark:text-content-muted-dark">
        Rows per page:
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="h-8 rounded-lg border border-surface-border bg-surface px-2 text-sm text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
        >
          {[10, 25, 50].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
