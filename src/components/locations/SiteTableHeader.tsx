import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SiteSort {
  key: string;
  direction: 'asc' | 'desc';
}

export interface SiteColumn {
  key: string;
  label: string;
  /** Share of the table width, measured off the reference. */
  width: string;
  align?: 'left' | 'center';
  /** Only the first column carries a sort control on both references. */
  sortable?: boolean;
}

interface SiteTableHeaderProps {
  columns: SiteColumn[];
  sort: SiteSort | null;
  onSortChange: (sort: SiteSort) => void;
}

/** Shared `<colgroup>` + `<thead>` for the locations and departments tables. */
export function SiteTableHeader({
  columns,
  sort,
  onSortChange,
}: SiteTableHeaderProps): JSX.Element {
  const toggle = (key: string): void =>
    onSortChange({
      key,
      direction: sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc',
    });

  return (
    <>
      <colgroup>
        {columns.map((column) => (
          <col key={column.key} className={column.width} />
        ))}
      </colgroup>
      <thead>
        <tr className="border-b border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
          {columns.map((column, index) => {
            const active = sort?.key === column.key;
            const Icon =
              !active || !sort
                ? ArrowUpDown
                : sort.direction === 'asc'
                  ? ArrowUp
                  : ArrowDown;
            const label = (
              <span className="whitespace-nowrap text-sm font-semibold text-content dark:text-content-dark">
                {column.label}
              </span>
            );
            return (
              <th
                key={column.key}
                scope="col"
                aria-sort={
                  column.sortable && active && sort
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
                className={cn(
                  'px-3 py-2.5',
                  index === 0 && 'pl-4',
                  column.align === 'center' && 'text-center',
                )}
              >
                {column.sortable ? (
                  <button
                    type="button"
                    onClick={() => toggle(column.key)}
                    className="flex items-center gap-1.5 text-sm font-semibold text-content transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-dark"
                  >
                    {column.label}
                    <Icon
                      size={13}
                      aria-hidden="true"
                      className={
                        active
                          ? 'text-primary'
                          : 'text-content-muted dark:text-content-muted-dark'
                      }
                    />
                  </button>
                ) : (
                  label
                )}
              </th>
            );
          })}
        </tr>
      </thead>
    </>
  );
}
