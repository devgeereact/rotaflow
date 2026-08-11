import { useState } from 'react';
import { Plus } from 'lucide-react';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Callout } from '@/components/ui/Callout';
import { StatTile } from '@/components/ui/StatTile';
import { DeclineLeaveModal } from '@/components/leave/DeclineLeaveModal';
import {
  LeaveRequestModal,
  type LeaveRequestDraft,
} from '@/components/leave/LeaveRequestModal';
import { LeaveRowsTable, type LeaveDisplayRow } from '@/components/leave/LeaveRowsTable';
import type { LeaveStatus } from '@/lib/leaveRows';

export interface ManagerLeaveTiles {
  awaitingDecision: number;
  /** "oldest 16 days", null when the queue is empty. */
  oldestPendingLabel: string | null;
  approvedNext30Days: number;
  sicknessDaysThisMonth: number;
  /** "Aug 25-29", or "Clear" when no cover clash was found in the lookahead window. */
  coverRiskLabel: string;
  /** "3 approved, 1 pending", null when the risk tile reads "Clear". */
  coverRiskSubLabel: string | null;
  /** "46%", or "No allowances set" when nobody has a `holiday_allowance`. */
  teamEntitlementUsedLabel: string;
}

export interface ManagerLeaveProps {
  tiles: ManagerLeaveTiles;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: LeaveStatus | '';
  onStatusFilterChange: (value: LeaveStatus | '') => void;
  rows: LeaveDisplayRow[];
  totalRowCount: number;
  onRequestLeave: (draft: LeaveRequestDraft) => Promise<void>;
  offline: boolean;
  onApprove: (row: LeaveDisplayRow) => Promise<void>;
  onDecline: (row: LeaveDisplayRow, reason: string) => Promise<void>;
}

/**
 * The manager's Leave (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.leave`
 * manager branch): requests, entitlement, and the cover consequence of
 * saying yes. Approve is immediate; Decline collects a mandatory reason
 * first (`DeclineLeaveModal`) — the reference's version is a bare button,
 * this one leaves a real audit trail instead of a silent toast.
 */
export function ManagerLeave({
  tiles,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  rows,
  totalRowCount,
  onRequestLeave,
  offline,
  onApprove,
  onDecline,
}: ManagerLeaveProps): JSX.Element {
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<LeaveDisplayRow | null>(null);
  const [declineBusy, setDeclineBusy] = useState(false);

  return (
    <div>
      <WorkspaceHeader
        title="Leave"
        subtitle="Requests, entitlement and the cover consequence of saying yes."
        actions={
          <Button onClick={() => setRequestOpen(true)}>
            <Plus size={16} aria-hidden="true" className="mr-1.5" />
            Request leave
          </Button>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="Awaiting decision"
          value={tiles.awaitingDecision}
          hint={
            tiles.oldestPendingLabel && (
              <span className="text-danger">{tiles.oldestPendingLabel}</span>
            )
          }
        />
        <StatTile label="Approved, next 30 days" value={tiles.approvedNext30Days} />
        <StatTile
          label="Days lost to sickness"
          value={tiles.sicknessDaysThisMonth}
          hint="this month"
        />
        <StatTile
          label="Cover risk"
          value={tiles.coverRiskLabel}
          hint={
            tiles.coverRiskSubLabel && (
              <span className="text-danger">{tiles.coverRiskSubLabel}</span>
            )
          }
        />
        <StatTile label="Team entitlement used" value={tiles.teamEntitlementUsedLabel} />
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
            placeholder="Search name or type…"
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
          actions="manager"
          approvingId={approvingId}
          onApprove={(row) => {
            setApprovingId(row.id);
            void onApprove(row).finally(() => setApprovingId(null));
          }}
          onDecline={(row) => setDeclineTarget(row)}
          emptyMessage="No leave requests match these filters."
        />
      </Card>

      <LeaveRequestModal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        submitting={requestSubmitting}
        offline={offline}
        onSubmit={(draft) => {
          setRequestSubmitting(true);
          void onRequestLeave(draft).finally(() => {
            setRequestSubmitting(false);
            setRequestOpen(false);
          });
        }}
      />

      <DeclineLeaveModal
        open={declineTarget !== null}
        staffName={
          declineTarget ? `${declineTarget.firstName} ${declineTarget.lastName}` : ''
        }
        busy={declineBusy}
        onClose={() => setDeclineTarget(null)}
        onConfirm={(reason) => {
          if (!declineTarget) return;
          setDeclineBusy(true);
          void onDecline(declineTarget, reason).finally(() => {
            setDeclineBusy(false);
            setDeclineTarget(null);
          });
        }}
      />
    </div>
  );
}
