import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { LeaveStatusPill } from '@/components/leave/LeaveStatusPill';
import { LeaveTypeChip } from '@/components/leave/LeaveTypeChip';
import type { LeaveRow } from '@/lib/leaveRows';

interface LeaveReviewModalProps {
  row: LeaveRow | null;
  onClose: () => void;
  /** Manager actions. Omitted for someone looking at their own request. */
  onApprove?: (id: string) => void;
  onDecline?: (id: string) => void;
  /** Staff withdrawing their own still-pending request. */
  onWithdraw?: (id: string) => void;
  busy: boolean;
  /** The request's free-text reason, where one was given. */
  reason: string | null;
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <p className="text-xs text-content-muted dark:text-content-muted-dark">{label}</p>
      <p className="text-sm font-medium text-content dark:text-content-dark">{value}</p>
    </div>
  );
}

/**
 * One request in full, with whatever decision the viewer is allowed to make.
 * The row's "Review"/"View" button and its overflow menu both open this. The
 * reference draws two controls but specifies only one destination.
 */
export function LeaveReviewModal({
  row,
  onClose,
  onApprove,
  onDecline,
  onWithdraw,
  busy,
  reason,
}: LeaveReviewModalProps): JSX.Element | null {
  if (!row) return null;
  const pending = row.status === 'pending';

  return (
    <Modal open onClose={onClose} title="Leave request">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <StaffAvatar
            firstName={row.firstName}
            lastName={row.lastName}
            photoUrl={row.photoUrl}
            size="lg"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-content dark:text-content-dark">
              {row.firstName} {row.lastName}
            </p>
            {row.jobTitle && (
              <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                {row.jobTitle}
              </p>
            )}
          </div>
          <span className="ml-auto shrink-0">
            <LeaveStatusPill status={row.status} />
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs text-content-muted dark:text-content-muted-dark">
              Leave type
            </p>
            <LeaveTypeChip type={row.type} />
          </div>
          <Field label="Duration" value={row.durationLabel} />
          <Field label="Dates" value={`${row.dateLabel} (${row.dayLabel})`} />
          <Field label="Requested" value={`${row.requestedLabel} · ${row.requestedBy}`} />
        </div>

        {reason && <Field label="Reason" value={reason} />}
        {row.statusNote && !pending && <Field label="Outcome" value={row.statusNote} />}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
          {pending && onWithdraw && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onWithdraw(row.id)}
            >
              Withdraw
            </Button>
          )}
          {pending && onDecline && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => onDecline(row.id)}
            >
              <X size={14} aria-hidden="true" />
              Decline
            </Button>
          )}
          {pending && onApprove && (
            <Button size="sm" disabled={busy} onClick={() => onApprove(row.id)}>
              <Check size={14} aria-hidden="true" />
              Approve
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
