import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import type { TimesheetDayStatus } from '@/lib/timesheetDayRows';
import { ScrollRegion } from '@/components/ui/ScrollRegion';

export interface TimesheetDisplayRow {
  staffId: string;
  shiftId: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  photoUrl: string | null;
  dayLabel: string;
  plannedLabel: string;
  actualLabel: string;
  paidLabel: string;
  status: TimesheetDayStatus;
  flag: string | null;
  /** True once this person's week has an approved timesheet on file. */
  approved: boolean;
}

const STATUS_LABEL: Record<TimesheetDayStatus, string> = {
  complete: 'Complete',
  late: 'Late',
  on_shift: 'On shift',
  absent: 'Absent',
};

const STATUS_TONE: Record<TimesheetDayStatus, BadgeTone> = {
  complete: 'success',
  late: 'warning',
  on_shift: 'info',
  absent: 'danger',
};

interface TimesheetRowsTableProps {
  rows: TimesheetDisplayRow[];
  /** Managers get per-row Amend/Approve; staff see "-" (`docs/ORGANISATION_WORKSPACE.html`'s table() for the staff role). */
  showActions: boolean;
  onAmend?: (row: TimesheetDisplayRow) => void;
  onApprove?: (row: TimesheetDisplayRow) => void;
  emptyMessage: string;
}

/**
 * The Timesheets table, shared by the manager and staff screens: same
 * columns either way, the reference reuses one `table()` call for both and
 * only the row set and the Actions column differ by role.
 */
export function TimesheetRowsTable({
  rows,
  showActions,
  onAmend,
  onApprove,
  emptyMessage,
}: TimesheetRowsTableProps): JSX.Element {
  if (rows.length === 0) {
    return (
      <p className="p-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ScrollRegion label="Timesheets">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-border text-left text-xs font-semibold uppercase tracking-wide text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
            <th className="px-4 py-3">Staff</th>
            <th className="px-4 py-3">Day</th>
            <th className="px-4 py-3">Planned</th>
            <th className="px-4 py-3">Actual</th>
            <th className="px-4 py-3 text-right">Paid</th>
            <th className="px-4 py-3">Status</th>
            {showActions && <th className="px-4 py-3 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-border dark:divide-surface-border-dark">
          {rows.map((row) => (
            <tr
              key={row.shiftId}
              className="hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark"
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <StaffAvatar
                    firstName={row.firstName}
                    lastName={row.lastName}
                    photoUrl={row.photoUrl}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-content dark:text-content-dark">
                      {row.firstName} {row.lastName}
                    </p>
                    {row.jobTitle && (
                      <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                        {row.jobTitle}
                      </p>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-content dark:text-content-dark">
                {row.dayLabel}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-content dark:text-content-dark">
                {row.plannedLabel}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-content dark:text-content-dark">
                {row.actualLabel}
              </td>
              <td className="px-4 py-3 text-right font-mono text-xs text-content dark:text-content-dark">
                {row.paidLabel}
              </td>
              <td className="px-4 py-3">
                <Badge tone={STATUS_TONE[row.status]} dot>
                  {STATUS_LABEL[row.status]}
                </Badge>
                {row.flag && (
                  <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
                    {row.flag}
                  </p>
                )}
              </td>
              {showActions && (
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => onAmend?.(row)}>
                      Amend
                    </Button>
                    <Button
                      size="sm"
                      variant={row.approved ? 'secondary' : 'primary'}
                      disabled={row.approved}
                      onClick={() => onApprove?.(row)}
                    >
                      {row.approved ? 'Approved' : 'Approve'}
                    </Button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
