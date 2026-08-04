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
  'whitespace-nowrap px-1.5 py-3 text-[0.66rem] font-semibold leading-4 text-content dark:text-content-dark';
const NUM_CELL =
  'px-1.5 py-2.5 text-center font-mono text-[0.76rem] font-semibold leading-4 tabular-nums text-content dark:text-content-dark';

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
      <table className="w-full min-w-[54rem] table-fixed border-collapse">
        <thead>
          <tr className="border-b border-surface-border dark:border-surface-border-dark">
            <th scope="col" className="w-[4%] py-3 pl-3 pr-1">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label="Select all timesheets"
                className="m-0 block h-4 w-4 rounded border-surface-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
              />
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'w-[13.4%] text-left')}>
              Staff
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'w-[10.8%] text-left')}>
              Week
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'w-[6.7%]')}>
              Shifts
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'w-[8.5%]')}>
              Regular Hours
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'w-[9%]')}>
              Overtime
            </th>
            {showDoubleTime && (
              <th scope="col" className={cn(HEAD_CELL, 'w-[8.8%]')}>
                Double Time
              </th>
            )}
            <th scope="col" className={cn(HEAD_CELL, 'w-[9%]')}>
              Total Hours
            </th>
            {showCost && (
              <th scope="col" className={cn(HEAD_CELL, 'w-[9.3%]')}>
                Total Cost
              </th>
            )}
            <th scope="col" className={cn(HEAD_CELL, 'w-[9.3%]')}>
              Status
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'w-[11.2%] text-right')}>
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
                <td className="py-2.5 pl-3 pr-1">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleRow(row.id)}
                    aria-label={`Select ${row.firstName} ${row.lastName}'s timesheet`}
                    className="m-0 block h-4 w-4 rounded border-surface-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
                  />
                </td>

                <td className="py-2.5 pl-1 pr-2">
                  <div className="flex items-center gap-2">
                    <StaffAvatar
                      firstName={row.firstName}
                      lastName={row.lastName}
                      photoUrl={row.photoUrl}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-[0.66rem] font-semibold leading-[1.125rem] text-content dark:text-content-dark">
                        {row.firstName} {row.lastName}
                      </p>
                      {row.jobTitle && (
                        <p className="truncate text-[0.6rem] leading-[0.875rem] text-content-muted dark:text-content-muted-dark">
                          {row.jobTitle}
                        </p>
                      )}
                    </div>
                  </div>
                </td>

                <td className="whitespace-nowrap px-1 py-2.5 text-[0.64rem] leading-4 text-content dark:text-content-dark">
                  {row.weekLabel}
                </td>
                <td className={NUM_CELL}>{row.shifts}</td>
                <td className={NUM_CELL}>{row.regularHours}</td>
                <td className={NUM_CELL}>{row.overtimeHours}</td>
                {showDoubleTime && (
                  <td className={NUM_CELL}>{row.doubleTimeHours ?? '—'}</td>
                )}
                <td className={NUM_CELL}>{row.totalHours}</td>
                {showCost && <td className={NUM_CELL}>{row.totalCost ?? '—'}</td>}

                <td className="px-0 py-2.5 text-center">
                  <TimesheetStatusPill status={row.status} />
                </td>

                <td className="py-2.5 pl-2 pr-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => onOpenRow(row.id)}
                      className="h-7 rounded-lg border border-surface-border px-2.5 text-[0.7rem] font-semibold text-content transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                    >
                      {needsDecision ? 'Review' : 'View'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRowMenu(row.id)}
                      aria-label={`More actions for ${row.firstName} ${row.lastName}`}
                      className="grid h-7 w-6 place-items-center rounded-lg border border-surface-border text-content-muted transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
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
