import { useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { QuickActionsCard } from '@/components/timesheets/QuickActionsCard';
import {
  OfferShiftModal,
  type OfferShiftDraft,
} from '@/components/swaps/OfferShiftModal';
import { SwapActivityCard } from '@/components/swaps/SwapActivityCard';
import { SwapDetailModal } from '@/components/swaps/SwapDetailModal';
import { SwapFilterBar } from '@/components/swaps/SwapFilterBar';
import { SwapOverviewCard } from '@/components/swaps/SwapOverviewCard';
import { SwapPagination } from '@/components/swaps/SwapPagination';
import { SwapTable } from '@/components/swaps/SwapTable';
import { SwapTabs } from '@/components/swaps/SwapTabs';
import { SwapTipBanner } from '@/components/swaps/SwapTipBanner';
import type { QuickAction } from '@/components/timesheets/QuickActionsCard';
import type { SwapActivityEntry } from '@/components/swaps/SwapActivityCard';
import type { SwapFilterSelect } from '@/components/swaps/SwapFilterBar';
import type { SwapTabDef } from '@/components/swaps/SwapTabs';
import type { SwapRow, SwapStatusCount, SwapTab } from '@/lib/swapRows';
import type { Shift, StaffProfile } from '@/types';

export interface SwapsViewProps {
  title: string;
  subtitle: string;

  tabs: SwapTabDef[];
  activeTab: SwapTab;
  onTabChange: (tab: SwapTab) => void;
  onExport: () => void;
  /** Hidden for a staff member with no profile in this org to offer from. */
  canRequest: boolean;

  periodLabel: string;
  onPeriodClick: () => void;
  selects: SwapFilterSelect[];
  onMoreFilters: () => void;

  rows: SwapRow[];
  onOpenRow: (row: SwapRow) => void;
  onRowMenu: (row: SwapRow) => void;
  onSortByRequested: () => void;
  emptyMessage: string;

  page: number;
  pageCount: number;
  rangeFrom: number;
  rangeTo: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;

  counts: SwapStatusCount[];
  overviewRangeLabel: string;
  onOverviewRangeClick: () => void;
  activity: SwapActivityEntry[];
  onViewAllActivity: () => void;
  quickActions: QuickAction[];
  onViewPolicy: () => void;

  myShifts: Shift[];
  colleagues: StaffProfile[];
  onOfferShift: (draft: OfferShiftDraft) => Promise<void>;
  offline: boolean;

  canApprove: boolean;
  viewerStaffId: string | null;
  openRow: SwapRow | null;
  onCloseDetail: () => void;
  onManagerDecision: (row: SwapRow, status: 'approved' | 'rejected') => Promise<void>;
  onColleagueDecision: (row: SwapRow, status: 'accepted' | 'rejected') => Promise<void>;
  onRequesterFinalize: (row: SwapRow, status: 'approved' | 'rejected') => Promise<void>;
  onWithdraw: (row: SwapRow) => Promise<void>;
}

/**
 * `/app/swaps` (`design/Swap-Request.png`): the shift-swap queue, its
 * review actions and its overview rail.
 *
 * Presentational: every figure and label arrives already computed, so the
 * live page and the design-loop preview render the identical tree.
 */
export function SwapsView(props: SwapsViewProps): JSX.Element {
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerSubmitting, setOfferSubmitting] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-page-title font-semibold text-content dark:text-content-dark">
          {props.title}
        </h1>
        <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
          {props.subtitle}
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_19.5rem]">
        <div className="min-w-0">
          <SwapTabs
            tabs={props.tabs}
            active={props.activeTab}
            onChange={props.onTabChange}
          />

          <div className="mt-4">
            <SwapFilterBar
              periodLabel={props.periodLabel}
              onPeriodClick={props.onPeriodClick}
              selects={props.selects}
              onMoreFilters={props.onMoreFilters}
            />
          </div>

          <Card className="mt-4 p-0">
            <SwapTable
              rows={props.rows}
              onOpenRow={(id) => {
                const row = props.rows.find((r) => r.id === id);
                if (row) props.onOpenRow(row);
              }}
              onRowMenu={(id) => {
                const row = props.rows.find((r) => r.id === id);
                if (row) props.onRowMenu(row);
              }}
              onSortByRequested={props.onSortByRequested}
              emptyMessage={props.emptyMessage}
            />
            {props.total > 0 && (
              <SwapPagination
                page={props.page}
                pageCount={props.pageCount}
                from={props.rangeFrom}
                to={props.rangeTo}
                total={props.total}
                pageSize={props.pageSize}
                onPageChange={props.onPageChange}
                onPageSizeChange={props.onPageSizeChange}
              />
            )}
          </Card>

          <div className="mt-4">
            <SwapTipBanner
              title="Tip: Encourage fair swaps"
              body="Ensure swaps are agreed in advance and do not leave the team short staffed."
              actionLabel="View Swap Policy"
              onAction={props.onViewPolicy}
            />
          </div>
        </div>

        <aside className="space-y-4">
          <div className="grid grid-cols-[2fr_3fr] gap-4">
            <button
              type="button"
              onClick={props.onExport}
              className="flex h-10 items-center justify-between rounded-xl border border-surface-border bg-surface px-4 text-[0.78rem] font-semibold text-content transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
            >
              Export
              <ChevronDown
                size={15}
                aria-hidden="true"
                className="text-content-muted dark:text-content-muted-dark"
              />
            </button>
            {props.canRequest && (
              <button
                type="button"
                onClick={() => setOfferOpen(true)}
                className="flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-3 text-[0.78rem] font-semibold text-primary-fg transition-transform duration-150 ease-in-out hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Plus size={16} aria-hidden="true" />
                New Swap Request
              </button>
            )}
          </div>

          <SwapOverviewCard
            counts={props.counts}
            rangeLabel={props.overviewRangeLabel}
            onRangeClick={props.onOverviewRangeClick}
          />
          <SwapActivityCard
            entries={props.activity}
            onViewAll={props.onViewAllActivity}
          />
          <QuickActionsCard actions={props.quickActions} />
        </aside>
      </div>

      <OfferShiftModal
        open={offerOpen}
        onClose={() => setOfferOpen(false)}
        myShifts={props.myShifts}
        colleagues={props.colleagues}
        submitting={offerSubmitting}
        offline={props.offline}
        onSubmit={(draft) => {
          setOfferSubmitting(true);
          void props.onOfferShift(draft).finally(() => {
            setOfferSubmitting(false);
            setOfferOpen(false);
          });
        }}
      />

      <SwapDetailModal
        row={props.openRow}
        onClose={props.onCloseDetail}
        canApprove={props.canApprove}
        viewerStaffId={props.viewerStaffId}
        busy={detailBusy}
        onManagerDecision={(status) => {
          if (!props.openRow) return;
          setDetailBusy(true);
          void props
            .onManagerDecision(props.openRow, status)
            .finally(() => setDetailBusy(false));
        }}
        onColleagueDecision={(status) => {
          if (!props.openRow) return;
          setDetailBusy(true);
          void props
            .onColleagueDecision(props.openRow, status)
            .finally(() => setDetailBusy(false));
        }}
        onRequesterFinalize={(status) => {
          if (!props.openRow) return;
          setDetailBusy(true);
          void props
            .onRequesterFinalize(props.openRow, status)
            .finally(() => setDetailBusy(false));
        }}
        onWithdraw={() => {
          if (!props.openRow) return;
          setDetailBusy(true);
          void props.onWithdraw(props.openRow).finally(() => setDetailBusy(false));
        }}
      />
    </div>
  );
}
