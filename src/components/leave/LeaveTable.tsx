import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { LeaveStatusPill } from '@/components/leave/LeaveStatusPill';
import { LeaveTypeChip } from '@/components/leave/LeaveTypeChip';
import type { LeaveRow } from '@/lib/leaveRows';

export type LeaveSortKey = 'staff' | 'dates' | 'requested';

export interface LeaveSort {
  key: LeaveSortKey;
  direction: 'asc' | 'desc';
}

interface LeaveTableProps {
  rows: LeaveRow[];
  /** `null` = the query's natural order (newest first); headers show the neutral glyph. */
  sort: LeaveSort | null;
  onSortChange: (sort: LeaveSort) => void;
  /** Opens the row, "Review" while it still needs a decision, else "View". */
  onOpenRow: (id: string) => void;
  onRowMenu: (id: string) => void;
  emptyMessage: string;
}

/**
 * Column widths as a share of the table, measured off design/Leave.png.
 * `sortable: false` columns still render a header, just no control.
 */
const COLUMNS: {
  key: LeaveSortKey | 'type' | 'duration' | 'status' | 'actions';
  label: string;
  width: string;
  sortable: boolean;
}[] = [
  { key: 'staff', label: 'Staff', width: 'w-[17%]', sortable: true },
  { key: 'type', label: 'Leave Type', width: 'w-[14.5%]', sortable: false },
  { key: 'dates', label: 'Dates', width: 'w-[15.5%]', sortable: true },
  { key: 'duration', label: 'Duration', width: 'w-[9.5%]', sortable: false },
  { key: 'status', label: 'Status', width: 'w-[13%]', sortable: false },
  { key: 'requested', label: 'Requested', width: 'w-[14.5%]', sortable: true },
  { key: 'actions', label: 'Actions', width: 'w-[16%]', sortable: false },
];

const HEAD_CELL =
  'whitespace-nowrap px-2 py-3.5 text-left text-[0.8rem] font-semibold text-content dark:text-content-dark';

/** The leave request list, one row per request (design/Leave.png). */
export function LeaveTable({
  rows,
  sort,
  onSortChange,
  onOpenRow,
  onRowMenu,
  emptyMessage,
}: LeaveTableProps): JSX.Element {
  const toggle = (key: LeaveSortKey): void =>
    onSortChange({
      key,
      direction: sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc',
    });

  if (rows.length === 0) {
    return (
      <p className="p-6 text-sm text-content-muted dark:text-content-muted-dark">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[58rem] table-fixed border-collapse">
        <colgroup>
          {COLUMNS.map((column) => (
            <col key={column.key} className={column.width} />
          ))}
        </colgroup>

        <thead>
          <tr className="border-b border-surface-border dark:border-surface-border-dark">
            {COLUMNS.map((column, index) => {
              const active = column.sortable && sort?.key === column.key;
              const Glyph = !active
                ? ArrowUpDown
                : sort.direction === 'asc'
                  ? ArrowUp
                  : ArrowDown;
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(HEAD_CELL, index === 0 && 'pl-4')}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggle(column.key as LeaveSortKey)}
                      className="inline-flex items-center gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {column.label}
                      <Glyph
                        size={13}
                        aria-hidden="true"
                        className={cn(
                          'shrink-0',
                          active
                            ? 'text-primary'
                            : 'text-content-muted dark:text-content-muted-dark',
                        )}
                      />
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const needsDecision = row.status === 'pending';
            return (
              <tr
                key={row.id}
                className="border-b border-divider last:border-0 dark:border-divider-dark"
              >
                <td className="px-2 py-3 pl-4">
                  <div className="flex items-center gap-2.5">
                    <StaffAvatar
                      firstName={row.firstName}
                      lastName={row.lastName}
                      photoUrl={row.photoUrl}
                      size="md"
                      className="h-8 w-8"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-[0.8rem] font-semibold leading-5 text-content dark:text-content-dark">
                        {row.firstName} {row.lastName}
                      </p>
                      {row.jobTitle && (
                        <p className="truncate text-[0.76rem] leading-4 text-content-muted dark:text-content-muted-dark">
                          {row.jobTitle}
                        </p>
                      )}
                    </div>
                  </div>
                </td>

                <td className="px-2 py-3">
                  <LeaveTypeChip type={row.type} />
                </td>

                <td className="px-2 py-3">
                  <p className="truncate text-[0.8rem] font-medium leading-5 text-content dark:text-content-dark">
                    {row.dateLabel}
                  </p>
                  <p className="truncate text-[0.76rem] leading-4 text-content-muted dark:text-content-muted-dark">
                    {row.dayLabel}
                  </p>
                </td>

                <td className="whitespace-nowrap px-2 py-3 text-[0.8rem] text-content dark:text-content-dark">
                  {row.durationLabel}
                </td>

                <td className="px-2 py-3">
                  <LeaveStatusPill status={row.status} />
                  {row.statusNote && (
                    <p className="mt-1 truncate text-[0.76rem] leading-4 text-content-muted dark:text-content-muted-dark">
                      {row.statusNote}
                    </p>
                  )}
                </td>

                <td className="px-2 py-3">
                  <p className="truncate text-[0.8rem] font-medium leading-5 text-content dark:text-content-dark">
                    {row.requestedLabel}
                  </p>
                  <p className="truncate text-[0.76rem] leading-4 text-content-muted dark:text-content-muted-dark">
                    {row.requestedBy}
                  </p>
                </td>

                <td className="px-2 py-3 pr-4">
                  <div className="flex items-center justify-end gap-6">
                    <button
                      type="button"
                      onClick={() => onOpenRow(row.id)}
                      className="flex h-9 w-28 items-center justify-between gap-2 rounded-xl border border-surface-border px-3 text-[0.8rem] font-semibold text-content transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                    >
                      {needsDecision ? 'Review' : 'View'}
                      <ChevronDown
                        size={15}
                        aria-hidden="true"
                        className="shrink-0 text-content-muted dark:text-content-muted-dark"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRowMenu(row.id)}
                      aria-label={`More actions for ${row.firstName} ${row.lastName}`}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-surface-border text-content-muted transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
                    >
                      <MoreVertical size={15} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
