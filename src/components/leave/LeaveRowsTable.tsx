import { Button } from '@/components/ui/Button';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { LeaveStatusPill } from '@/components/leave/LeaveStatusPill';
import { LeaveTypeChip } from '@/components/leave/LeaveTypeChip';
import type { LeaveStatus, LeaveTypeKey } from '@/lib/leaveRows';
import { ScrollRegion } from '@/components/ui/ScrollRegion';

export interface LeaveDisplayRow {
  id: string;
  firstName: string;
  lastName: string;
  department: string | null;
  photoUrl: string | null;
  type: LeaveTypeKey;
  /** Pre-formatted, e.g. "30 May-1 June 2025". */
  dateLabel: string;
  durationDays: number;
  status: LeaveStatus;
  /**
   * The muted line under the pill: who reviewed it, or that it is still
   * waiting. Never a decline reason — `leave_requests` has no column for one,
   * it exists only in the audit trail (`DeclineLeaveModal`).
   */
  statusNote: string | null;
  /** Pre-formatted, e.g. "Today, 09:15". */
  requestedLabel: string;
}

interface LeaveRowsTableProps {
  rows: LeaveDisplayRow[];
  /** Manager gets Decline/Approve on a pending row; staff gets Withdraw on their own. */
  actions: 'manager' | 'staff' | 'none';
  onApprove?: (row: LeaveDisplayRow) => void;
  approvingId?: string | null;
  onDecline?: (row: LeaveDisplayRow) => void;
  onWithdraw?: (row: LeaveDisplayRow) => void;
  withdrawingId?: string | null;
  emptyMessage: string;
}

/**
 * The Leave request table (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.leave` `table()` call), shared by the manager and staff screens —
 * same columns either way, only the Actions column differs by role.
 */
export function LeaveRowsTable({
  rows,
  actions,
  onApprove,
  approvingId,
  onDecline,
  onWithdraw,
  withdrawingId,
  emptyMessage,
}: LeaveRowsTableProps): JSX.Element {
  if (rows.length === 0) {
    return (
      <p className="p-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ScrollRegion label="Leave requests">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-border text-left text-xs font-semibold uppercase tracking-wide text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
            <th className="px-4 py-3">Person</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Dates</th>
            <th className="px-4 py-3 text-right">Days</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Requested</th>
            {actions !== 'none' && <th className="px-4 py-3 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-border dark:divide-surface-border-dark">
          {rows.map((row) => (
            <tr
              key={row.id}
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
                    {row.department && (
                      <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                        {row.department}
                      </p>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <LeaveTypeChip type={row.type} />
              </td>
              <td className="px-4 py-3 text-content dark:text-content-dark">
                {row.dateLabel}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-content dark:text-content-dark">
                {row.durationDays}
              </td>
              <td className="px-4 py-3">
                <LeaveStatusPill status={row.status} />
                {row.statusNote && (
                  <p className="mt-1 max-w-[34ch] text-xs text-content-muted dark:text-content-muted-dark">
                    {row.statusNote}
                  </p>
                )}
              </td>
              <td className="px-4 py-3 text-content-muted dark:text-content-muted-dark">
                {row.requestedLabel}
              </td>
              {actions !== 'none' && (
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {actions === 'manager' && row.status === 'pending' && (
                      <>
                        <Button
                          size="sm"
                          variant="danger-outline"
                          disabled={approvingId === row.id}
                          onClick={() => onDecline?.(row)}
                        >
                          Decline
                        </Button>
                        <Button
                          size="sm"
                          disabled={approvingId === row.id}
                          onClick={() => onApprove?.(row)}
                        >
                          {approvingId === row.id ? 'Approving…' : 'Approve'}
                        </Button>
                      </>
                    )}
                    {actions === 'staff' && row.status === 'pending' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={withdrawingId === row.id}
                        onClick={() => onWithdraw?.(row)}
                      >
                        {withdrawingId === row.id ? 'Withdrawing…' : 'Withdraw'}
                      </Button>
                    )}
                    {row.status !== 'pending' && (
                      <span className="text-content-muted dark:text-content-muted-dark">
                        -
                      </span>
                    )}
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
