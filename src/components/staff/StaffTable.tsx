import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { StaffTableRow } from '@/components/staff/StaffTableRow';
import { cn } from '@/lib/utils';
import type { StaffDirectoryRow } from '@/lib/staffDirectory';

export type StaffSortKey =
  'staff' | 'role' | 'department' | 'location' | 'skills' | 'availability' | 'status';

export interface StaffSort {
  key: StaffSortKey;
  direction: 'asc' | 'desc';
}

interface StaffTableProps {
  rows: StaffDirectoryRow[];
  /** `null` = the roster's natural order; every header then shows the neutral glyph. */
  sort: StaffSort | null;
  onSortChange: (sort: StaffSort) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenActions: (id: string) => void;
}

/**
 * Column widths as a share of the table, measured off design/staff.png. The
 * Skills column carries chips and needs roughly twice any other column.
 */
const COLUMNS: { key: StaffSortKey; label: string; width: string }[] = [
  { key: 'staff', label: 'Staff', width: 'w-[16%]' },
  { key: 'role', label: 'Role', width: 'w-[12%]' },
  { key: 'department', label: 'Department', width: 'w-[10%]' },
  { key: 'location', label: 'Location', width: 'w-[12%]' },
  { key: 'skills', label: 'Skills', width: 'w-[23%]' },
  { key: 'availability', label: 'Availability', width: 'w-[11%]' },
  { key: 'status', label: 'Status', width: 'w-[10%]' },
];

/** The staff directory table. Header, sortable columns and rows. */
export function StaffTable({
  rows,
  sort,
  onSortChange,
  selectedId,
  onSelect,
  onOpenActions,
}: StaffTableProps): JSX.Element {
  const toggle = (key: StaffSortKey): void =>
    onSortChange({
      key,
      direction: sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc',
    });

  return (
    <table className="w-full table-fixed border-collapse text-left">
      <colgroup>
        {COLUMNS.map((column) => (
          <col key={column.key} className={column.width} />
        ))}
        <col className="w-[6%]" />
      </colgroup>
      <thead>
        <tr className="border-b border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
          {COLUMNS.map((column, index) => {
            const active = sort?.key === column.key;
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
                  active && sort
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
                className={cn('px-3 py-3', index === 0 && 'pl-2.5')}
              >
                <button
                  type="button"
                  onClick={() => toggle(column.key)}
                  className="flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-content transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-dark"
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
              </th>
            );
          })}
          <th scope="col" className="px-3 py-3">
            <span className="whitespace-nowrap text-sm font-semibold text-content dark:text-content-dark">
              Actions
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <StaffTableRow
            key={row.id}
            row={row}
            selected={row.id === selectedId}
            onSelect={onSelect}
            onOpenActions={onOpenActions}
          />
        ))}
      </tbody>
    </table>
  );
}
