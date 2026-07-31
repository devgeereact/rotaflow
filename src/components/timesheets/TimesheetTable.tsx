import { MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { TimesheetStatusPill } from '@/components/timesheets/TimesheetStatusPill';
import type { TimesheetRow } from '@/lib/timesheetRows';

interface TimesheetTableProps {
  rows: TimesheetRow[];
  selectedIds: string[];
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  /** Opens the row — "Review" when it still needs a decision, else "View". */
  onOpenRow: (id: string) => void;
  onRowMenu: (id: string) => void;
  /** Hidden entirely when no pay rate exists to cost the hours with. */
  showCost: boolean;
  /** Hidden when the org has no double-time rule. */
  showDoubleTime: boolean;
  emptyMessage: string;
}

const HEAD_CELL =
  'whitespace-nowrap px-1.5 py-3 text-[0.72rem] font-semibold text-content dark:text-content-dark';
const NUM_CELL =
  'px-1.5 py-2.5 text-center text-[0.76rem] tabular-nums text-content dark:text-content-dark';

/** The timesheet list — one row per person per week (design/Timesheets-Dashboard.png). */
export function TimesheetTable({
  rows,
  selectedIds,
  onToggleRow,
  onToggleAll,
  onOpenRow,
  onRowMenu,
  showCost,
  showDoubleTime,
  emptyMessage,
}: TimesheetTableProps): JSX.Element {
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;

  if (rows.length === 0) {
    return (
      <p className="p-6 text-sm text-content-muted dark:text-content-muted-dark">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[54rem] border-collapse">
        <thead>
          <tr className="border-b border-surface-border dark:border-surface-border-dark">
            <th scope="col" className="w-9 px-2 py-3">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label="Select all timesheets"
                className="h-4 w-4 rounded border-surface-border accent-primary dark:border-surface-border-dark"
              />
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'text-left')}>
              Staff
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'text-left')}>
              Week
            </th>
            <th scope="col" className={HEAD_CELL}>
              Shifts
            </th>
            <th scope="col" className={HEAD_CELL}>
              Regular Hours
            </th>
            <th scope="col" className={HEAD_CELL}>
              Overtime
            </th>
            {showDoubleTime && (
              <th scope="col" className={HEAD_CELL}>
                Double Time
              </th>
            )}
            <th scope="col" className={HEAD_CELL}>
              Total Hours
            </th>
            {showCost && (
              <th scope="col" className={HEAD_CELL}>
                Total Cost
              </th>
            )}
            <th scope="col" className={HEAD_CELL}>
              Status
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'text-right')}>
              Actions
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const selected = selectedIds.includes(row.id);
            const needsDecision = row.status === 'pending';
            return (
              <tr
                key={row.id}
                className="border-b border-divider last:border-0 dark:border-divider-dark"
              >
                <td className="px-2 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleRow(row.id)}
                    aria-label={`Select ${row.firstName} ${row.lastName}'s timesheet`}
                    className="h-4 w-4 rounded border-surface-border accent-primary dark:border-surface-border-dark"
                  />
                </td>

                <td className="px-2 py-2.5">
                  <div className="flex items-center gap-2">
                    <StaffAvatar
                      firstName={row.firstName}
                      lastName={row.lastName}
                      photoUrl={row.photoUrl}
                      size="md"
                      className="h-8 w-8"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-[0.76rem] font-semibold leading-5 text-content dark:text-content-dark">
                        {row.firstName} {row.lastName}
                      </p>
                      {row.jobTitle && (
                        <p className="truncate text-[0.7rem] leading-4 text-content-muted dark:text-content-muted-dark">
                          {row.jobTitle}
                        </p>
                      )}
                    </div>
                  </div>
                </td>

                <td className="whitespace-nowrap px-2 py-2.5 text-[0.76rem] text-content dark:text-content-dark">
                  {row.weekLabel}
                </td>
                <td className={NUM_CELL}>{row.shifts}</td>
                <td className={NUM_CELL}>{row.regularHours}</td>
                <td className={NUM_CELL}>{row.overtimeHours}</td>
                {showDoubleTime && (
                  <td className={NUM_CELL}>{row.doubleTimeHours ?? '—'}</td>
                )}
                <td className={cn(NUM_CELL, 'font-semibold')}>{row.totalHours}</td>
                {showCost && <td className={NUM_CELL}>{row.totalCost ?? '—'}</td>}

                <td className="px-2 py-2.5 text-center">
                  <TimesheetStatusPill status={row.status} />
                </td>

                <td className="px-2 py-2.5">
                  <div className="flex items-center justify-end gap-0.5">
                    <button
                      type="button"
                      onClick={() => onOpenRow(row.id)}
                      className="h-8 rounded-lg border border-surface-border px-2.5 text-[0.72rem] font-semibold text-content transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                    >
                      {needsDecision ? 'Review' : 'View'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRowMenu(row.id)}
                      aria-label={`More actions for ${row.firstName} ${row.lastName}`}
                      className="grid h-7 w-7 place-items-center rounded-lg text-content-muted transition-colors hover:bg-surface-subtle dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
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
