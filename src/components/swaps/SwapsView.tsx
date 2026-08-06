import { ChevronDown, Plus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { QuickActionsCard } from '@/components/timesheets/QuickActionsCard';
import { SwapActivityCard } from '@/components/swaps/SwapActivityCard';
import { SwapFilterBar } from '@/components/swaps/SwapFilterBar';
import { SwapOverviewCard } from '@/components/swaps/SwapOverviewCard';
import { SwapPagination } from '@/components/swaps/SwapPagination';
import { SwapRulesCard } from '@/components/swaps/SwapRulesCard';
import { SwapTable } from '@/components/swaps/SwapTable';
import { SwapTabs } from '@/components/swaps/SwapTabs';
import { SwapTipBanner } from '@/components/swaps/SwapTipBanner';
import type { QuickAction } from '@/components/timesheets/QuickActionsCard';
import type { SwapFilterSelect } from '@/components/swaps/SwapFilterBar';
import type { SwapTabDef } from '@/components/swaps/SwapTabs';
import type { SwapActivityEntry } from '@/components/swaps/SwapActivityCard';
import type { SwapRule } from '@/components/swaps/SwapRulesCard';
import type { SwapRow, SwapStatusCount, SwapTab } from '@/lib/swapRows';

export interface SwapsViewProps {
  /** Page heading, "Swaps" for a manager, narrowed for a staff member. */
  title: string;
  subtitle: string;

  tabs: SwapTabDef[];
  activeTab: SwapTab;
  onTabChange: (tab: SwapTab) => void;
  onExport: () => void;
  onNewRequest: () => void;
  /** Hidden for staff, who cannot raise a request on someone else's behalf. */
  canRequest: boolean;

  periodLabel: string;
  onPeriodClick: () => void;
  selects: SwapFilterSelect[];
  onMoreFilters: () => void;

  rows: SwapRow[];
  onOpenRow: (id: string) => void;
  onRowMenu: (id: string) => void;
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
  /** Omitted where no swap-policy store exists to read from. */
  rules?: SwapRule[];
  onEditRules?: () => void;
  activity: SwapActivityEntry[];
  onViewAllActivity: () => void;
  quickActions: QuickAction[];
  onViewPolicy: () => void;
}

/**
 * `/app/swaps`. The shift-swap queue and its manager review actions
 * (design/Swap-Request.png).
 *
 * Presentational only: every figure and label arrives already computed, so the
 * live page and the design preview render the identical tree.
 */
export function SwapsView(props: SwapsViewProps): JSX.Element {
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
              onOpenRow={props.onOpenRow}
              onRowMenu={props.onRowMenu}
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
                onClick={props.onNewRequest}
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
          {props.rules && (
            <SwapRulesCard rules={props.rules} onEdit={props.onEditRules} />
          )}
          <SwapActivityCard
            entries={props.activity}
            onViewAll={props.onViewAllActivity}
          />
          <QuickActionsCard actions={props.quickActions} />
        </aside>
      </div>
    </div>
  );
}
