import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TablePaginationProps {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  /** How many rows this page actually shows. The last page is usually short. */
  shown: number;
  /** Plural noun for the range summary: "…of 12 locations". */
  noun: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const PAGE_SIZES = [10, 25, 50];

const BOX =
  'grid h-8 min-w-8 place-items-center rounded-lg border border-surface-border bg-surface px-2 text-sm font-medium ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
  'dark:border-surface-border-dark dark:bg-surface-dark';

/**
 * Collapses a long page list to `1 2 3 … last`, matching the reference's
 * ellipsis. Always keeps the first, last and current pages visible.
 */
function pageItems(page: number, pageCount: number): (number | 'gap')[] {
  if (pageCount <= 5) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const middle = [page - 1, page, page + 1].filter((p) => p > 1 && p < pageCount);
  const items: (number | 'gap')[] = [1];
  if (middle.length === 0 || middle[0]! > 2) items.push(2, 3);
  items.push(...middle.filter((p) => !items.includes(p)));
  items.push('gap', pageCount);
  return items;
}

/**
 * Table footer: range summary, pager, rows-per-page. Drawn identically on
 * docs/design/staff.png, docs/design/Locations-Management.png and
 * docs/design/Location-department.png, only the noun changes.
 */
export function TablePagination({
  page,
  pageCount,
  pageSize,
  total,
  shown,
  noun,
  onPageChange,
  onPageSizeChange,
}: TablePaginationProps): JSX.Element {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = from + shown - (shown > 0 ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5">
      <p className="text-sm text-content-muted dark:text-content-muted-dark">
        Showing {from} to {to} of {total} {noun}
      </p>

      <nav aria-label={`${noun} pages`} className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
          className={cn(
            BOX,
            'text-content-muted hover:bg-surface-subtle disabled:opacity-40 dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark',
          )}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>

        {pageItems(page, pageCount).map((item, index) =>
          item === 'gap' ? (
            <span
              key={`gap-${index}`}
              aria-hidden="true"
              className="grid h-8 min-w-8 place-items-center text-sm text-content-muted dark:text-content-muted-dark"
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
                BOX,
                item === page
                  ? 'border-primary bg-primary text-primary-fg dark:border-primary dark:bg-primary'
                  : 'text-content hover:bg-surface-subtle dark:text-content-dark dark:hover:bg-surface-subtle-dark',
              )}
            >
              {item}
            </button>
          ),
        )}

        <button
          type="button"
          aria-label="Next page"
          disabled={page === pageCount}
          onClick={() => onPageChange(page + 1)}
          className={cn(
            BOX,
            'text-content-muted hover:bg-surface-subtle disabled:opacity-40 dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark',
          )}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </nav>

      <div className="flex items-center gap-3">
        <span className="text-sm text-content-muted dark:text-content-muted-dark">
          Rows per page:
        </span>
        <div className="relative">
          <select
            value={pageSize}
            aria-label="Rows per page"
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className={cn(
              BOX,
              'appearance-none pl-3 pr-8 text-content dark:text-content-dark',
            )}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-content-muted dark:text-content-muted-dark"
          />
        </div>
      </div>
    </div>
  );
}
