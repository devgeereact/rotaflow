import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SWAP_STATUS_LABEL } from '@/lib/swapRows';
import type { SwapRow } from '@/lib/swapRows';

interface SwapDetailModalProps {
  row: SwapRow | null;
  onClose: () => void;
  canApprove: boolean;
  viewerStaffId: string | null;
  busy: boolean;
  /** Manager deciding an open swap, or an accepted one alongside the requester. */
  onManagerDecision: (status: 'approved' | 'rejected') => void;
  /** The named colleague accepting or declining. */
  onColleagueDecision: (status: 'accepted' | 'rejected') => void;
  /**
   * The requester's own final say once the colleague has accepted —
   * `0043_swap_requester_finalize.sql`. No manager step is needed for a
   * swap both people already agreed to.
   */
  onRequesterFinalize: (status: 'approved' | 'rejected') => void;
  onWithdraw: () => void;
}

/** The row-detail dialog opened by "Review"/"View" (`design/Swap-Request.png`). */
export function SwapDetailModal({
  row,
  onClose,
  canApprove,
  viewerStaffId,
  busy,
  onManagerDecision,
  onColleagueDecision,
  onRequesterFinalize,
  onWithdraw,
}: SwapDetailModalProps): JSX.Element {
  const isRequester = row?.fromStaffId === viewerStaffId;
  const isTarget = row?.toStaffId === viewerStaffId;

  return (
    <Modal open={Boolean(row)} onClose={onClose} title="Swap request">
      {row && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-content dark:text-content-dark">
            {row.from.firstName} {row.from.lastName} →{' '}
            {row.to ? `${row.to.firstName} ${row.to.lastName}` : 'anyone'}
          </p>
          {row.shift && (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              {row.shift.dateLabel} · {row.shift.timeLabel}
              {row.shift.locationName ? ` · ${row.shift.locationName}` : ''}
            </p>
          )}
          {row.note && (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              “{row.note}”
            </p>
          )}
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            {SWAP_STATUS_LABEL[row.status]}
            {row.statusNote ? `, ${row.statusNote}` : ''}
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            {canApprove && (row.status === 'open' || row.status === 'accepted') && (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => onManagerDecision('approved')}
                >
                  <Check size={14} aria-hidden="true" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onManagerDecision('rejected')}
                >
                  <X size={14} aria-hidden="true" />
                  Decline
                </Button>
              </>
            )}
            {isTarget && row.status === 'awaiting_colleague' && (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => onColleagueDecision('accepted')}
                >
                  <Check size={14} aria-hidden="true" />
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onColleagueDecision('rejected')}
                >
                  <X size={14} aria-hidden="true" />
                  Decline
                </Button>
              </>
            )}
            {isRequester && row.status === 'accepted' && (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => onRequesterFinalize('approved')}
                >
                  <Check size={14} aria-hidden="true" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onRequesterFinalize('rejected')}
                >
                  <X size={14} aria-hidden="true" />
                  Decline
                </Button>
              </>
            )}
            {isRequester &&
              (row.status === 'open' ||
                row.status === 'awaiting_colleague' ||
                row.status === 'accepted') && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={onWithdraw}>
                  Withdraw
                </Button>
              )}
          </div>
        </div>
      )}
    </Modal>
  );
}
