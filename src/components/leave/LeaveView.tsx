import { ChevronDown, Download, Plus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { LeaveApprovalQueueCard } from '@/components/leave/LeaveApprovalQueueCard';
import { LeaveBalancesCard } from '@/components/leave/LeaveBalancesCard';
import { LeaveFilterBar } from '@/components/leave/LeaveFilterBar';
import { LeaveOverviewCard } from '@/components/leave/LeaveOverviewCard';
import { LeavePagination } from '@/components/leave/LeavePagination';
import { LeaveQuickActionsCard } from '@/components/leave/LeaveQuickActionsCard';
import { LeaveTable } from '@/components/leave/LeaveTable';
import { LeaveTabs } from '@/components/leave/LeaveTabs';
import { LeaveTipBanner } from '@/components/leave/LeaveTipBanner';
import type { LeaveFilterSelect } from '@/components/leave/LeaveFilterBar';
import type { LeaveQuickAction } from '@/components/leave/LeaveQuickActionsCard';
import type { LeaveSort } from '@/components/leave/LeaveTable';
import type { LeaveTab, LeaveTabDef } from '@/components/leave/LeaveTabs';
import type {
  LeaveApprovalCount,
  LeaveBalance,
  LeaveRow,
  LeaveTypeCount,
} from '@/lib/leaveRows';

export interface LeaveViewProps {
  tabs: LeaveTabDef[];
  activeTab: LeaveTab;
  onTabChange: (tab: LeaveTab) => void;
  onExport: () => void;
  onRequestLeave: () => void;

  periodLabel: string;
  onPeriodClick: () => void;
  selects: LeaveFilterSelect[];
  onFilters: () => void;

  rows: LeaveRow[];
  sort: LeaveSort | null;
  onSortChange: (sort: LeaveSort) => void;
  onOpenRow: (id: string) => void;
  onRowMenu: (id: string) => void;
  emptyMessage: string;

  page: number;
  pageCount: number;
  rangeFrom: number;
  rangeTo: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;

  counts: LeaveTypeCount[];
  overviewRangeLabel: string;
  onOverviewRangeClick: () => void;
  balances: LeaveBalance[];
  onViewAllBalances: () => void;
  approvalQueues: LeaveApprovalCount[];
  onViewAllApprovals: () => void;
  onOpenQueue: (id: string) => void;
  quickActions: LeaveQuickAction[];
  onViewTeamCalendar: () => void;
}

/**
 * `/app/leave` — the request table, its filters and the balances rail
 * (design/Leave.png).
 *
 * Presentational only: every figure and every label arrives already computed,
 * so the authenticated page and the design preview render the identical tree.
 */
export function LeaveView(props: LeaveViewProps): JSX.Element {
  return (
    <div>
      <div className="mb-7">
        <h1 className="font-display text-page-title font-semibold text-content dark:text-content-dark">
          Leave
        </h1>
        <p className="mt-1 text-[0.88rem] text-content-muted dark:text-content-muted-dark">
          Manage leave requests, approvals and leave balances.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <LeaveTabs
            tabs={props.tabs}
            active={props.activeTab}
            onChange={props.onTabChange}
          />
        </div>
        <div className="flex shrink-0 items-center gap-5 pb-3">
          <button
            type="button"
            onClick={props.onExport}
            className="flex h-10 items-center justify-center gap-2 rounded-xl border border-surface-border bg-surface px-4 text-[0.88rem] font-semibold text-content transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
          >
            <Download size={16} aria-hidden="true" />
            Export
            <ChevronDown
              size={15}
              aria-hidden="true"
              className="text-content-muted dark:text-content-muted-dark"
            />
          </button>
          <button
            type="button"
            onClick={props.onRequestLeave}
            className="flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-10 text-[0.88rem] font-semibold text-primary-fg transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Plus size={17} aria-hidden="true" />
            Request Leave
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0">
          <div className="mb-6 mt-6">
            <LeaveFilterBar
              periodLabel={props.periodLabel}
              onPeriodClick={props.onPeriodClick}
              selects={props.selects}
              onFilters={props.onFilters}
            />
          </div>

          <Card className="p-0">
            <LeaveTable
              rows={props.rows}
              sort={props.sort}
              onSortChange={props.onSortChange}
              onOpenRow={props.onOpenRow}
              onRowMenu={props.onRowMenu}
              emptyMessage={props.emptyMessage}
            />
            {props.total > 0 && (
              <LeavePagination
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

          <div className="mt-6">
            <LeaveTipBanner
              title="Tip: Encourage early requests"
              body="Encouraging your team to submit leave requests early helps you plan better coverage."
              actionLabel="View Team Calendar"
              onAction={props.onViewTeamCalendar}
            />
          </div>
        </div>

        <aside className="space-y-4">
          <LeaveOverviewCard
            counts={props.counts}
            rangeLabel={props.overviewRangeLabel}
            onRangeClick={props.onOverviewRangeClick}
          />
          <LeaveBalancesCard
            balances={props.balances}
            onViewAll={props.onViewAllBalances}
          />
          <LeaveApprovalQueueCard
            items={props.approvalQueues}
            onViewAll={props.onViewAllApprovals}
            onOpen={props.onOpenQueue}
          />
          <LeaveQuickActionsCard actions={props.quickActions} />
        </aside>
      </div>
    </div>
  );
}
