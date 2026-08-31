import type { BankHolidayRegion } from '@/lib/bankHolidays';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatTile } from '@/components/ui/StatTile';
import {
  LeaveRequestModal,
  type LeaveRequestDraft,
} from '@/components/leave/LeaveRequestModal';
import { LeaveRowsTable, type LeaveDisplayRow } from '@/components/leave/LeaveRowsTable';
import type { LeaveStatus } from '@/lib/leaveRows';

export interface StaffLeaveTiles {
  /** "28 days", or "Not set" when no `holiday_allowance` is on file. */
  entitlementLabel: string;
  takenLabel: string;
  /** "11 days", or "-" when entitlement is not set. */
  remainingLabel: string;
  remainingSubLabel: string | null;
  pendingLabel: string;
}

export interface StaffLeaveProps {
  tiles: StaffLeaveTiles;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: LeaveStatus | '';
  onStatusFilterChange: (value: LeaveStatus | '') => void;
  rows: LeaveDisplayRow[];
  totalRowCount: number;
  onRequestLeave: (draft: LeaveRequestDraft) => Promise<void>;
  offline: boolean;
  onWithdraw: (row: LeaveDisplayRow) => Promise<void>;
  /** Passed through to the request dialog, which names the bank holidays in range. */
  bankHolidayRegion: BankHolidayRegion;
}

/**
 * A staff member's own Leave (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.leave` staff branch): their entitlement, their requests, and
 * where each has got to. Withdraw is real (`cancelLeaveRequest`), not the
 * reference's toast-only version.
 */
export function StaffLeave({
  tiles,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  rows,
  totalRowCount,
  onRequestLeave,
  offline,
  onWithdraw,
  bankHolidayRegion,
}: StaffLeaveProps): JSX.Element {
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  return (
    <div>
      <WorkspaceHeader
        title="Leave"
        subtitle="Your entitlement, your requests, and where each one has got to."
        actions={
          <Button onClick={() => setRequestOpen(true)}>
            <Plus size={16} aria-hidden="true" className="mr-1.5" />
            Request leave
          </Button>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Entitlement" value={tiles.entitlementLabel} />
        <StatTile label="Taken" value={tiles.takenLabel} />
        <StatTile
          label="Remaining"
          value={tiles.remainingLabel}
          hint={
            tiles.remainingSubLabel && (
              <span className="text-success">{tiles.remainingSubLabel}</span>
            )
          }
        />
        <StatTile label="Pending" value={tiles.pendingLabel} />
      </div>

      <Callout className="mb-4">
        Balances show <strong>annual leave only</strong>. The organisation holds a single
        holiday allowance per person, so sickness, unpaid and compassionate leave are
        recorded and approved here but are not deducted from a separate balance.
      </Callout>

      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-surface-border p-4 dark:border-surface-border-dark">
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search type…"
            aria-label="Search leave"
            className="w-auto flex-1 sm:max-w-xs"
          />
          <Select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value as LeaveStatus | '')}
            aria-label="Status"
            className="w-auto py-2"
          >
            <option value="">Any status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Declined</option>
            <option value="cancelled">Cancelled</option>
          </Select>
          <span className="ml-auto font-mono text-xs text-content-muted dark:text-content-muted-dark">
            {rows.length} of {totalRowCount}
          </span>
        </div>

        <LeaveRowsTable
          rows={rows}
          actions="staff"
          withdrawingId={withdrawingId}
          onWithdraw={(row) => {
            setWithdrawingId(row.id);
            void onWithdraw(row).finally(() => setWithdrawingId(null));
          }}
          emptyMessage="You have no leave requests yet."
        />
      </Card>

      <LeaveRequestModal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        submitting={requestSubmitting}
        offline={offline}
        bankHolidayRegion={bankHolidayRegion}
        onSubmit={(draft) => {
          setRequestSubmitting(true);
          void onRequestLeave(draft).finally(() => {
            setRequestSubmitting(false);
            setRequestOpen(false);
          });
        }}
      />
    </div>
  );
}
