import { useState } from 'react';
import { Plus } from 'lucide-react';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { StatTile } from '@/components/ui/StatTile';
import {
  RaiseClaimModal,
  type RaiseClaimDraft,
} from '@/components/overtime/RaiseClaimModal';
import type { OvertimeRow, OvertimeStatus } from '@/lib/overtimeRows';

const STATUS_LABEL: Record<OvertimeStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Declined',
  cancelled: 'Withdrawn',
};

const STATUS_TONE: Record<OvertimeStatus, BadgeTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

export interface OvertimeTiles {
  /** Manager: "Awaiting decision" count. Staff: same, their own only. */
  awaitingDecision: number;
  /** Manager: sum of pending hours. Staff: same. Pre-formatted. */
  awaitingDecisionHoursLabel: string;
  /** Manager: hours approved this month, org-wide. Staff: their own, all-time. */
  secondLabel: string;
  secondValue: string;
  requestsShown: number;
}

export interface OvertimeViewProps {
  canApprove: boolean;
  tiles: OvertimeTiles;
  rows: OvertimeRow[];
  totalRowCount: number;
  statusFilter: OvertimeStatus | '';
  onStatusFilterChange: (value: OvertimeStatus | '') => void;
  viewerStaffId: string | null;
  emptyMessage: string;
  onRaiseClaim: (draft: RaiseClaimDraft) => Promise<void>;
  onApprove: (row: OvertimeRow) => Promise<void>;
  onDecline: (row: OvertimeRow) => Promise<void>;
  onWithdraw: (row: OvertimeRow) => Promise<void>;
}

/**
 * `/app/overtime` (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.overtime`).
 * One view for everyone: the reference shows "Raise a claim" to both roles
 * unconditionally and never gates the table's Person column by role, so the
 * My/Team toggle the previous build had is dropped — a manager loses
 * nothing, their own claims are just rows in the same team table.
 */
export function OvertimeView({
  canApprove,
  tiles,
  rows,
  totalRowCount,
  statusFilter,
  onStatusFilterChange,
  viewerStaffId,
  emptyMessage,
  onRaiseClaim,
  onApprove,
  onDecline,
  onWithdraw,
}: OvertimeViewProps): JSX.Element {
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseSubmitting, setRaiseSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  return (
    <div>
      <WorkspaceHeader
        title="Overtime"
        subtitle={
          canApprove
            ? 'Claims raised by staff, and what they cost. Approving here sends the hours to payroll.'
            : 'Hours you worked beyond your rostered shift. Raise them while you still remember why.'
        }
        actions={
          <Button onClick={() => setRaiseOpen(true)}>
            <Plus size={16} aria-hidden="true" className="mr-1.5" />
            Raise a claim
          </Button>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Awaiting decision" value={tiles.awaitingDecision} />
        <StatTile
          label={canApprove ? 'Pending hours' : 'Awaiting decision'}
          value={tiles.awaitingDecisionHoursLabel}
        />
        <StatTile label={tiles.secondLabel} value={tiles.secondValue} />
        <StatTile label="Requests shown" value={tiles.requestsShown} />
      </div>

      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-surface-border p-4 dark:border-surface-border-dark">
          <h2 className="font-semibold text-content dark:text-content-dark">Claims</h2>
          <Select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value as OvertimeStatus | '')}
            aria-label="Status"
            className="ml-auto w-auto py-2"
          >
            <option value="">Any status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Declined</option>
            <option value="cancelled">Withdrawn</option>
          </Select>
          <span className="font-mono text-xs text-content-muted dark:text-content-muted-dark">
            {rows.length} of {totalRowCount}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
            {emptyMessage}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left text-xs font-semibold uppercase tracking-wide text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
                  <th className="px-4 py-3">Person</th>
                  <th className="px-4 py-3">Day</th>
                  <th className="px-4 py-3 text-right">Hours</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border dark:divide-surface-border-dark">
                {rows.map((row) => {
                  const isOwn = row.staffProfileId === viewerStaffId;
                  return (
                    <tr
                      key={row.id}
                      className="hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <StaffAvatar
                            firstName={row.staffName.split(' ')[0] ?? ''}
                            lastName={row.staffName.split(' ').slice(1).join(' ')}
                            photoUrl={row.photoUrl}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-content dark:text-content-dark">
                              {row.staffName}
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
                        {row.dateLabel}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-content dark:text-content-dark">
                        {row.hoursLabel}
                      </td>
                      <td className="px-4 py-3 text-content-muted dark:text-content-muted-dark">
                        {row.note ?? '-'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={STATUS_TONE[row.status]} dot>
                          {STATUS_LABEL[row.status]}
                        </Badge>
                        {row.statusNote && (
                          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
                            {row.statusNote}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {row.status === 'pending' && canApprove && (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busyId === row.id}
                                onClick={() => {
                                  setBusyId(row.id);
                                  void onDecline(row).finally(() => setBusyId(null));
                                }}
                              >
                                Decline
                              </Button>
                              <Button
                                size="sm"
                                disabled={busyId === row.id}
                                onClick={() => {
                                  setBusyId(row.id);
                                  void onApprove(row).finally(() => setBusyId(null));
                                }}
                              >
                                Approve
                              </Button>
                            </>
                          )}
                          {row.status === 'pending' && !canApprove && isOwn && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busyId === row.id}
                              onClick={() => {
                                setBusyId(row.id);
                                void onWithdraw(row).finally(() => setBusyId(null));
                              }}
                            >
                              Withdraw
                            </Button>
                          )}
                          {(row.status !== 'pending' || (!canApprove && !isOwn)) && (
                            <span className="text-content-muted dark:text-content-muted-dark">
                              -
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <RaiseClaimModal
        open={raiseOpen}
        onClose={() => setRaiseOpen(false)}
        submitting={raiseSubmitting}
        onSubmit={(draft) => {
          setRaiseSubmitting(true);
          void onRaiseClaim(draft).finally(() => {
            setRaiseSubmitting(false);
            setRaiseOpen(false);
          });
        }}
      />
    </div>
  );
}
