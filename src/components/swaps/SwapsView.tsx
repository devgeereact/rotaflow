import { useState } from 'react';
import { Repeat2 } from 'lucide-react';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/StatTile';
import {
  OfferShiftModal,
  type OfferShiftDraft,
} from '@/components/swaps/OfferShiftModal';
import { SwapRefusalReasonsCard } from '@/components/swaps/SwapRefusalReasonsCard';
import { SwapRequestRow } from '@/components/swaps/SwapRequestRow';
import type { SwapRow } from '@/lib/swapRows';
import type { Shift, StaffProfile } from '@/types';

export interface SwapsTiles {
  openOnBoard: number;
  waitingOnYou: number;
  approvedThisMonth: number;
  declined: number;
}

export interface SwapsViewProps {
  canApprove: boolean;
  viewerStaffId: string | null;
  tiles: SwapsTiles;
  rows: SwapRow[];
  emptyMessage: string;
  myShifts: Shift[];
  colleagues: StaffProfile[];
  onOfferShift: (draft: OfferShiftDraft) => Promise<void>;
  offline: boolean;
  onManagerDecision: (row: SwapRow, status: 'approved' | 'rejected') => Promise<void>;
  onColleagueDecision: (row: SwapRow, status: 'accepted' | 'rejected') => Promise<void>;
  onWithdraw: (row: SwapRow) => Promise<void>;
}

/**
 * `/app/swaps` (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.swaps`). One
 * view for everyone, not a role split — the mockup itself uses the same
 * four tiles and the same request list for a manager and a colleague, only
 * the "Waiting on you" figure and a row's available actions differ, and
 * those already vary by the viewer's relationship to each row rather than a
 * blanket role check.
 */
export function SwapsView({
  canApprove,
  viewerStaffId,
  tiles,
  rows,
  emptyMessage,
  myShifts,
  colleagues,
  onOfferShift,
  offline,
  onManagerDecision,
  onColleagueDecision,
  onWithdraw,
}: SwapsViewProps): JSX.Element {
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerSubmitting, setOfferSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  return (
    <div>
      <WorkspaceHeader
        title="Shift swaps"
        subtitle="A swap needs a taker and a manager. Anything that would break cover or a rest rule is refused at the point of offer, not after it is agreed."
        actions={
          <Button onClick={() => setOfferOpen(true)}>
            <Repeat2 size={16} aria-hidden="true" className="mr-1.5" />
            Offer a shift
          </Button>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open on the board" value={tiles.openOnBoard} />
        <StatTile label="Waiting on you" value={tiles.waitingOnYou} />
        <StatTile label="Approved this month" value={tiles.approvedThisMonth} />
        <StatTile label="Declined" value={tiles.declined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card className="p-0">
          <div className="border-b border-surface-border p-4 dark:border-surface-border-dark">
            <h2 className="font-semibold text-content dark:text-content-dark">
              Requests
            </h2>
          </div>
          {rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
              {emptyMessage}
            </p>
          ) : (
            <div>
              {rows.map((row) => (
                <SwapRequestRow
                  key={row.id}
                  row={row}
                  canApprove={canApprove}
                  isRequester={row.fromStaffId === viewerStaffId}
                  isTarget={row.toStaffId === viewerStaffId}
                  busy={busyId === row.id}
                  onManagerDecision={(status) => {
                    setBusyId(row.id);
                    void onManagerDecision(row, status).finally(() => setBusyId(null));
                  }}
                  onColleagueDecision={(status) => {
                    setBusyId(row.id);
                    void onColleagueDecision(row, status).finally(() => setBusyId(null));
                  }}
                  onWithdraw={() => {
                    setBusyId(row.id);
                    void onWithdraw(row).finally(() => setBusyId(null));
                  }}
                />
              ))}
            </div>
          )}
        </Card>

        <SwapRefusalReasonsCard />
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
