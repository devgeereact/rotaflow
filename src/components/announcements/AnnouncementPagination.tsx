import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AnnouncementPaginationProps {
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

const BOX =
  'grid h-9 min-w-9 place-items-center rounded-lg text-xs font-semibold transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

const NEUTRAL =
  'border border-surface-border text-content hover:bg-surface-subtle ' +
  'dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark';

/**
 * Collapses a long page list to `1 2 3 … last`, matching the reference's
 * ellipsis. Always keeps the first, last and current pages visible.
 */
function pageItems(page: number, pageCount: number): (number | 'gap')[] {
  if (pageCount <= 5) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const middle = [page - 1, page, page + 1].filter((p) => p > 1 && p < pageCount);
  const items: (number | 'gap')[] = [1];
  if (middle.length === 0 || middle[0]! >= 2) items.push(2, 3);
  items.push(...middle.filter((p) => !items.includes(p)));
  items.push('gap', pageCount);
  return items;
}

/** Table footer: range summary, pager, rows-per-page (design/Announcements-Dashboard.png). */
export function AnnouncementPagination({
  page,
  pageCount,
  from,
  to,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: AnnouncementPaginationProps): JSX.Element {
  return (
    // Three tracks, not `justify-between`: the reference centres the pager on the
    // card, which only holds if the outer cells are equal — they are not.
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-t border-divider px-5 py-3.5 dark:border-divider-dark">
      <p className="text-xs text-content-muted dark:text-content-muted-dark">
        Showing {from} to {to} of {total} announcements
      </p>

      <nav aria-label="Announcement pages" className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className={cn(
            BOX,
            NEUTRAL,
            'text-content-muted disabled:opacity-40 disabled:hover:bg-transparent dark:text-content-muted-dark',
          )}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>

        {pageItems(page, pageCount).map((item, index) =>
          item === 'gap' ? (
            <span
              key={`gap-${index}`}
              aria-hidden="true"
              className="grid h-9 min-w-9 place-items-center text-xs text-content-muted dark:text-content-muted-dark"
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              aria-current={item === page ? 'page' : undefined}
              className={cn(BOX, item === page ? 'bg-primary text-primary-fg' : NEUTRAL)}
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
          className={cn(
            BOX,
            NEUTRAL,
            'text-content-muted disabled:opacity-40 disabled:hover:bg-transparent dark:text-content-muted-dark',
          )}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </nav>

      <div className="flex items-center justify-end gap-2.5">
        <span className="text-xs text-content-muted dark:text-content-muted-dark">
          Rows per page:
        </span>
        <div className="relative">
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label="Rows per page"
            // A native select paints its own background, so it needs one that
            // follows the theme — the sibling buttons can stay transparent.
            className={cn(
              BOX,
              NEUTRAL,
              'appearance-none bg-surface pl-3 pr-8 text-center dark:bg-surface-dark',
            )}
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
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-content-muted dark:text-content-muted-dark"
          />
        </div>
      </div>
    </div>
  );
}
