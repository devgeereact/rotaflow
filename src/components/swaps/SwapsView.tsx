import { useState } from 'react';
import { Plus } from 'lucide-react';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import { SwapRequestRow } from '@/components/swaps/SwapRequestRow';
import { SwapRulesCard, type SwapRule } from '@/components/swaps/SwapRulesCard';
import {
  OfferShiftModal,
  type OfferShiftDraft,
} from '@/components/swaps/OfferShiftModal';
import { countSwapTiles } from '@/lib/swapRows';
import type { SwapRow } from '@/lib/swapRows';
import type { Shift, StaffProfile } from '@/types';

export interface SwapsViewProps {
  rows: SwapRow[];
  loading: boolean;
  emptyMessage: string;
  canApprove: boolean;
  viewerStaffId: string | null;
  rules: SwapRule[];
  myShifts: Shift[];
  colleagues: StaffProfile[];
  onOfferShift: (draft: OfferShiftDraft) => Promise<void>;
  offline: boolean;
  onManagerDecision: (row: SwapRow, status: 'approved' | 'rejected') => Promise<void>;
  onColleagueDecision: (row: SwapRow, status: 'accepted' | 'rejected') => Promise<void>;
  onRequesterFinalize: (row: SwapRow, status: 'approved' | 'rejected') => Promise<void>;
  onClaim: (row: SwapRow) => Promise<void>;
  onWithdraw: (row: SwapRow) => Promise<void>;
}

/**
 * `/app/swaps` (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.swaps`): a
 * pagehead, four count tiles, and a two-column grid — the Requests list and
 * the Rules card. No tabs, filters, pagination, donut or activity rail; the
 * reference does not have them, and this screen is the sole reference now.
 */
export function SwapsView({
  rows,
  loading,
  emptyMessage,
  canApprove,
  viewerStaffId,
  rules,
  myShifts,
  colleagues,
  onOfferShift,
  offline,
  onManagerDecision,
  onColleagueDecision,
  onRequesterFinalize,
  onClaim,
  onWithdraw,
}: SwapsViewProps): JSX.Element {
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerSubmitting, setOfferSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const tiles = countSwapTiles(rows);

  const runBusy = (id: string, action: () => Promise<void>): void => {
    setBusyId(id);
    void action().finally(() => setBusyId(null));
  };

  return (
    <div>
      <WorkspaceHeader
        title="Shift swaps"
        subtitle="A swap needs a taker and, unless it was agreed between two named colleagues, a manager. Anything that would break cover or a rest rule should be checked before you approve it."
        actions={
          <Button onClick={() => setOfferOpen(true)} disabled={!viewerStaffId}>
            <Plus size={16} aria-hidden="true" className="mr-1.5" />
            Offer a shift
          </Button>
        }
      />

      <TileGrid className="mb-5">
        <StatTile label="Open on the board" value={tiles.open} />
        <StatTile label="Waiting on you" value={canApprove ? tiles.waitingOnYou : 0} />
        <StatTile label="Approved" value={tiles.approved} />
        <StatTile label="Declined" value={tiles.declined} />
      </TileGrid>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="p-0">
          <div className="border-b border-surface-border p-4 dark:border-surface-border-dark">
            <h2 className="font-semibold text-content dark:text-content-dark">
              Requests
            </h2>
          </div>
          {loading ? (
            <p className="p-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
              {emptyMessage}
            </p>
          ) : (
            rows.map((row) => (
              <SwapRequestRow
                key={row.id}
                row={row}
                canApprove={canApprove}
                isRequester={Boolean(viewerStaffId) && row.fromStaffId === viewerStaffId}
                isTarget={Boolean(viewerStaffId) && row.toStaffId === viewerStaffId}
                canClaim={Boolean(viewerStaffId) && row.fromStaffId !== viewerStaffId}
                busy={busyId === row.id}
                onManagerDecision={(status) =>
                  runBusy(row.id, () => onManagerDecision(row, status))
                }
                onColleagueDecision={(status) =>
                  runBusy(row.id, () => onColleagueDecision(row, status))
                }
                onRequesterFinalize={(status) =>
                  runBusy(row.id, () => onRequesterFinalize(row, status))
                }
                onClaim={() => runBusy(row.id, () => onClaim(row))}
                onWithdraw={() => runBusy(row.id, () => onWithdraw(row))}
              />
            ))
          )}
        </Card>

        <SwapRulesCard rules={rules} />
      </div>

      <OfferShiftModal
        open={offerOpen}
        onClose={() => setOfferOpen(false)}
        myShifts={myShifts}
        colleagues={colleagues}
        submitting={offerSubmitting}
        offline={offline}
        onSubmit={(draft) => {
          setOfferSubmitting(true);
          void onOfferShift(draft).finally(() => {
            setOfferSubmitting(false);
            setOfferOpen(false);
          });
        }}
      />
    </div>
  );
}
