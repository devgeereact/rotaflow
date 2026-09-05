import type { KeyboardEvent, ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DataTableSort<Key extends string = string> {
  key: Key;
  direction: 'asc' | 'desc';
}

export interface DataTableColumn<Row, Key extends string = string> {
  key: Key;
  label: string;
  /** Share of the table width, e.g. `w-[18%]`. Omit to let content size it. */
  width?: string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  /**
   * A column of figures: right-aligned, monospaced and tabular.
   *
   * Digits in the app's UI face are proportional, so a column of counts or
   * money sat on a ragged left edge and the eye could not compare two rows
   * without reading both. Implies `align: 'right'`.
   */
  numeric?: boolean;
  /** Renders the cell. Kept on the column so a table is one declaration. */
  cell: (row: Row) => ReactNode;
}

interface DataTableProps<Row, Key extends string> {
  columns: readonly DataTableColumn<Row, Key>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** `null` is the collection's natural order. Every header shows the neutral glyph. */
  sort?: DataTableSort<Key> | null;
  onSortChange?: (sort: DataTableSort<Key>) => void;
  onRowClick?: (row: Row) => void;
  selectedKey?: string | null;
  emptyMessage?: string;
  /** Screen-reader description of what the table lists. */
  caption: string;
  className?: string;
}

const ALIGN = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const;

/**
 * Column headings are labels, not headings.
 *
 * They were `text-sm font-semibold` in ink. The same weight and colour as the
 * data underneath, so on a forty-row table the header row read as just another
 * row. Small caps in the muted tone let the eye skip past them to the figures,
 * which is what a header row is for. docs/DESIGN.md caption scale.
 */
const HEAD_LABEL =
  'inline-flex items-center gap-1.5 whitespace-nowrap text-[0.69rem] font-semibold uppercase tracking-[0.06em] text-content-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark';

/**
 * The shared sortable table.
 *
 * ## Why this exists
 *
 * Ten feature tables had been hand-rolled to the same convention
 * (`StaffTable`, `LocationsTable`, `LeaveTable`, `SwapTable`,
 * `TimesheetTable`, `AnnouncementTable`, `ReportsTable`, …) and the platform
 * console added seven more as raw `<table>` markup with no sorting, no
 * pagination and no empty state. They shared a *convention*, not a component,
 * so each one re-decided keyboard behaviour, `aria-sort`, the neutral sort
 * glyph and the zebra/hover treatment, and the console's seven simply
 * skipped all of it.
 *
 * `locations/SiteTableHeader` was already most of the way here: it exports a
 * reusable column descriptor and is shared by two tables. This generalises
 * that header over the row body, and takes `StaffTable`'s props contract
 * (rows, sort, onSortChange, selectedKey) as the surface, since nine screens
 * already speak it.
 *
 * Presentational only, no data fetching, no local sort state. The parent owns
 * the sorted array, exactly as the existing tables do, so a page renders
 * identically from Supabase and from design-loop fixtures.
 */
export function DataTable<Row, Key extends string = string>({
  columns,
  rows,
  rowKey,
  sort = null,
  onSortChange,
  onRowClick,
  selectedKey = null,
  emptyMessage = 'Nothing to show.',
  caption,
  className,
}: DataTableProps<Row, Key>): JSX.Element {
  const toggle = (key: Key): void => {
    if (!onSortChange) return;
    onSortChange({
      key,
      direction: sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc',
    });
  };

  return (
    // Focusable, named and announced as a region: WCAG 2.2 Level A, 2.1.1
    // Keyboard (docs/SAAS.md GAP-070). A pointer user drags a horizontally
    // scrolling table sideways; a keyboard user has no way to scroll a plain
    // `div` at all, so on a narrow viewport every column past the fold was
    // simply unreadable — including Thursday and Friday on the rota grid,
    // which is `min-w-[860px]`.
    //
    // `tabIndex={0}` is what makes the arrow keys work. `role="region"` plus
    // the caption as its accessible name is what stops that new tab stop
    // being an unlabelled mystery to a screen-reader user, and is the pairing
    // the technique (SCR34 / ARIA a11y practices) actually calls for.
    <div
      className={cn('overflow-x-auto', className)}
      // A scrollable region is the documented exception to the rule below: it
      // is not interactive, and it must still be reachable, which is why that
      // rule's own `roles` option lists `region`. Removing this would satisfy
      // the linter by restoring the barrier.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} className={column.width} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
            {columns.map((column, index) => {
              const active = sort?.key === column.key;
              const sortable = Boolean(column.sortable && onSortChange);
              const Icon =
                !active || !sort
                  ? ArrowUpDown
                  : sort.direction === 'asc'
                    ? ArrowUp
                    : ArrowDown;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    sortable && active && sort
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                  className={cn(
                    'px-3 py-2.5',
                    index === 0 && 'pl-4',
                    index === columns.length - 1 && 'pr-4',
                    ALIGN[column.numeric ? 'right' : (column.align ?? 'left')],
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggle(column.key)}
                      className={cn(
                        HEAD_LABEL,
                        'transition-colors hover:text-primary dark:text-primary-ink-dark',
                      )}
                    >
                      {column.label}
                      <Icon
                        size={12}
                        aria-hidden="true"
                        className={
                          active
                            ? 'text-primary dark:text-primary-ink-dark'
                            : 'text-content-muted dark:text-content-muted-dark'
                        }
                      />
                    </button>
                  ) : (
                    <span className={HEAD_LABEL}>{column.label}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  // A row is only interactive when the caller gave it
                  // somewhere to go. Without onRowClick this stays a plain
                  // row rather than a div dressed as one.
                  {...(onRowClick
                    ? {
                        onClick: () => onRowClick(row),
                        onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        },
                        tabIndex: 0,
                        role: 'button' as const,
                        'aria-pressed': selectedKey === key,
                      }
                    : {})}
                  className={cn(
                    'border-b border-divider last:border-0 dark:border-divider-dark',
                    onRowClick &&
                      'cursor-pointer transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary dark:hover:bg-surface-subtle-dark',
                    selectedKey === key && 'bg-primary-wash dark:bg-primary-wash-dark',
                  )}
                >
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={cn(
                        'px-3 py-2.5 align-middle text-sm text-content dark:text-content-dark',
                        index === 0 && 'pl-4',
                        index === columns.length - 1 && 'pr-4',
                        column.numeric && 'font-mono tabular-nums',
                        ALIGN[column.numeric ? 'right' : (column.align ?? 'left')],
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
