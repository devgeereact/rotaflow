import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SwapParties } from '@/components/swaps/SwapParties';
import { SwapShiftSide } from '@/components/swaps/SwapShiftSide';
import { SWAP_STATUS_LABEL, SWAP_STATUS_TONE } from '@/lib/swapRows';
import type { SwapRow } from '@/lib/swapRows';

interface SwapRequestRowProps {
  row: SwapRow;
  canApprove: boolean;
  isRequester: boolean;
  isTarget: boolean;
  busy: boolean;
  onManagerDecision: (status: 'approved' | 'rejected') => void;
  onColleagueDecision: (status: 'accepted' | 'rejected') => void;
  onWithdraw: () => void;
}

/**
 * One row of the Requests card (`SCREENS.swaps`'s `state.swaps.map(...)`).
 * Actions are keyed off the viewer's relationship to the row rather than a
 * single `mgr` flag: the mockup only ever has a manager or the requester
 * looking at a row, but the real schema's optional named colleague adds a
 * third viewer — the target, who can accept or decline before a manager
 * ever sees it.
 */
export function SwapRequestRow({
  row,
  canApprove,
  isRequester,
  isTarget,
  busy,
  onManagerDecision,
  onColleagueDecision,
  onWithdraw,
}: SwapRequestRowProps): JSX.Element {
  const managerCanDecide =
    canApprove && (row.status === 'open' || row.status === 'awaiting_manager');
  const colleagueCanRespond = isTarget && row.status === 'awaiting_colleague';
  const requesterCanWithdraw =
    isRequester &&
    (row.status === 'open' ||
      row.status === 'awaiting_colleague' ||
      row.status === 'awaiting_manager');

  return (
    <div className="grid gap-2.5 border-b border-surface-border p-4 last:border-0 dark:border-surface-border-dark">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-[220px] flex-1">
          <SwapParties from={row.from} to={row.to} />
        </div>
        <div className="flex gap-6">
          <SwapShiftSide side="giving" shift={row.shift} />
        </div>
        <div className="ml-auto text-right">
          <Badge tone={SWAP_STATUS_TONE[row.status]} dot>
            {SWAP_STATUS_LABEL[row.status]}
          </Badge>
          {row.statusNote && (
            <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
              {row.statusNote}
            </p>
          )}
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            {row.requestedLabel}
          </p>
        </div>
      </div>

      {row.note && (
        <p className="text-[0.8rem] text-content-muted dark:text-content-muted-dark">
          &ldquo;{row.note}&rdquo;
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {managerCanDecide && (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => onManagerDecision('rejected')}
            >
              Decline
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onManagerDecision('approved')}
            >
              Approve
            </Button>
          </>
        )}
        {colleagueCanRespond && (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => onColleagueDecision('rejected')}
            >
              Decline
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onColleagueDecision('accepted')}
            >
              Accept
            </Button>
          </>
        )}
        {requesterCanWithdraw && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onWithdraw}>
            Withdraw
          </Button>
        )}
        {row.status === 'approved' && (
          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            Rota updated and both people notified.
          </p>
        )}
      </div>
    </div>
  );
}
