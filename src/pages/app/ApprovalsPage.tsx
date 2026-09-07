import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCheck, Repeat2, TimerReset, Umbrella } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { listOrgLeaveRequests, reviewLeaveRequest } from '@/services/leaveService';
import { decideShiftSwap, listOrgShiftSwaps } from '@/services/swapService';
import {
  listOrgOvertimeRequests,
  reviewOvertimeRequest,
} from '@/services/overtimeService';
import { listStaff } from '@/services/staffService';
import {
  buildApprovalQueue,
  WAITING_TOO_LONG_DAYS,
  type ApprovalRow,
} from '@/lib/approvalQueue';
import { reportError } from '@/lib/sentry';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageHeader } from '@/components/ui/PageHeader';
import type { LeaveRequest, OvertimeRequest, StaffProfile } from '@/types';
import type { ShiftSwapWithShift } from '@/services/swapService';

const KIND_ICON = {
  leave: Umbrella,
  swap: Repeat2,
  overtime: TimerReset,
} as const;

const KIND_LABEL = {
  leave: 'Leave',
  swap: 'Swap',
  overtime: 'Overtime',
} as const;

/**
 * `/app/approvals` — everything waiting on a manager, in one place (CAP-093).
 *
 * ## Why this exists
 *
 * Leave, swaps and overtime each had their own screen, and the dashboard tile
 * counted two of the three. "What is waiting for me" meant opening three
 * pages and remembering the third, and the request somebody had been chasing
 * longest was the hardest thing in the product to find.
 *
 * ## Oldest first, always
 *
 * No sort control. The whole point is that nothing is forgotten, and every
 * ordering other than oldest-first buries the request that has been waiting a
 * fortnight under this morning's.
 *
 * ## It does not replace the three screens
 *
 * Each row links to its own screen, because a decision sometimes needs
 * context this list cannot hold — who else is off that week, what the swap
 * does to rest hours. This is for the ones that do not.
 */
export function ApprovalsPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canApprove } = usePermissions();
  const { user } = useSupabaseAuth();
  const { showError, showSuccess } = useToast();

  const [leave, setLeave] = useState<LeaveRequest[]>([]);
  const [swaps, setSwaps] = useState<ShiftSwapWithShift[]>([]);
  const [overtime, setOvertime] = useState<OvertimeRequest[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useRealtimeRefresh({
    tables: ['leave_requests', 'shift_swaps', 'overtime_requests'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => setReloadKey((k) => k + 1),
  });

  useEffect(() => {
    if (!orgId || !canApprove) return;
    let active = true;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const [leaveRows, swapRows, overtimeRows, staffRows] = await Promise.all([
          listOrgLeaveRequests(orgId),
          listOrgShiftSwaps(orgId),
          listOrgOvertimeRequests(orgId),
          listStaff(orgId, { includeInactive: true }),
        ]);
        if (!active) return;
        setLeave(leaveRows);
        setSwaps(swapRows);
        setOvertime(overtimeRows);
        setStaff(staffRows);
      } catch (err) {
        reportError(err, { area: 'approvals:load' });
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, canApprove, reloadKey]);

  // `new Date()` is read here rather than inside the builder so the ordering
  // and the day counts are testable, and so every row in one render is
  // measured against the same instant.
  const rows = useMemo(
    () => buildApprovalQueue({ leave, swaps, overtime, staff, now: new Date() }),
    [leave, swaps, overtime, staff],
  );

  const handleDecision = useCallback(
    async (row: ApprovalRow, approve: boolean): Promise<void> => {
      if (!user) return;
      const status = approve ? 'approved' : 'rejected';
      setDeciding(row.id);
      try {
        if (row.kind === 'leave') {
          const decided = await reviewLeaveRequest(row.id, status, user.id);
          if (!decided) {
            // Somebody else decided it, or the person withdrew it, between
            // this list loading and the click (BUG-061).
            showError('That request has already been decided. Reloading.');
          } else {
            showSuccess(approve ? 'Leave approved.' : 'Leave declined.');
          }
        } else if (row.kind === 'overtime') {
          const decided = await reviewOvertimeRequest(row.id, status, user.id);
          if (!decided) {
            showError('That claim has already been decided. Reloading.');
          } else {
            showSuccess(approve ? 'Overtime approved.' : 'Overtime declined.');
          }
        } else {
          const swap = swaps.find((s) => s.id === row.id);
          if (!swap) return;
          // Shared with `SwapsPage`: approving a swap also moves the shift,
          // and two copies of that would drift.
          const decision = await decideShiftSwap(swap, status);
          if (decision.outcome === 'already-decided') {
            showError('That swap has already been decided. Reloading.');
          } else if (decision.outcome === 'refused') {
            // The decision and the reassignment commit together since 0123,
            // so a refusal means nothing changed at all.
            showError(decision.reason);
          } else if (decision.outcome === 'declined') {
            showSuccess('Swap declined.');
          } else {
            showSuccess(
              decision.reassigned
                ? 'Swap approved and the shift reassigned.'
                : 'Swap approved. Assign the shift in the Rota Builder.',
            );
          }
        }
      } catch (err) {
        reportError(err, { area: `approvals:${row.kind}` });
        showError('That decision could not be recorded.');
      } finally {
        setDeciding(null);
        setReloadKey((k) => k + 1);
      }
    },
    [user, swaps, showError, showSuccess],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Leave, swaps and overtime waiting on a decision. Longest wait first."
      />

      {loading ? (
        <LoadingState variant="table" rows={4} label="Loading approvals" />
      ) : failed ? (
        <Card>
          <EmptyState
            title="Approvals could not be loaded"
            description="Check your connection and try again."
            action={<Button onClick={() => setReloadKey((k) => k + 1)}>Try again</Button>}
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={CheckCheck}
            title="Nothing is waiting"
            description="Leave, swaps and overtime all decided. New requests appear here."
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const Icon = KIND_ICON[row.kind];
            return (
              <li key={`${row.kind}-${row.id}`}>
                <Card className="flex flex-wrap items-center gap-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary-ink dark:text-primary-ink-dark">
                    <Icon size={18} aria-hidden="true" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-content dark:text-content-dark">
                      {row.personName}
                    </p>
                    <p className="text-sm text-content-muted dark:text-content-muted-dark">
                      {KIND_LABEL[row.kind]} · {row.summary}
                    </p>
                  </div>

                  {row.waitingDays >= WAITING_TOO_LONG_DAYS ? (
                    <Badge tone="warning">Waiting {row.waitingDays} days</Badge>
                  ) : (
                    <span className="text-xs text-content-muted dark:text-content-muted-dark">
                      {row.waitingDays === 0 ? 'Today' : `${row.waitingDays}d`}
                    </span>
                  )}

                  <Link
                    to={row.to}
                    className="text-sm font-medium text-primary-ink underline dark:text-primary-ink-dark"
                  >
                    Open
                  </Link>

                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={deciding !== null}
                      onClick={() => void handleDecision(row, false)}
                    >
                      Decline
                    </Button>
                    <Button
                      disabled={deciding !== null}
                      onClick={() => void handleDecision(row, true)}
                    >
                      {deciding === row.id ? 'Saving…' : 'Approve'}
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
