import { Check, ChevronDown, Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PendingApprovalCard } from '@/components/timesheets/PendingApprovalCard';
import { QuickActionsCard } from '@/components/timesheets/QuickActionsCard';
import { TimesheetFilterBar } from '@/components/timesheets/TimesheetFilterBar';
import { TimesheetPagination } from '@/components/timesheets/TimesheetPagination';
import { TimesheetRulesCard } from '@/components/timesheets/TimesheetRulesCard';
import { TimesheetSummaryCard } from '@/components/timesheets/TimesheetSummaryCard';
import { TimesheetTable } from '@/components/timesheets/TimesheetTable';
import { TimesheetTabs } from '@/components/timesheets/TimesheetTabs';
import { TimesheetTipBanner } from '@/components/timesheets/TimesheetTipBanner';
import type { TimesheetRow, TimesheetStatusCount } from '@/lib/timesheetRows';
import type {
  TimesheetTab,
  TimesheetTabDef,
} from '@/components/timesheets/TimesheetTabs';
import type { FilterOption } from '@/components/timesheets/TimesheetFilterBar';
import type { PendingTimesheet } from '@/components/timesheets/PendingApprovalCard';
import type { TimesheetRule } from '@/components/timesheets/TimesheetRulesCard';
import type { QuickAction } from '@/components/timesheets/QuickActionsCard';
import type { ReactNode } from 'react';

export interface TimesheetsViewProps {
  /** Six summary tiles, already built by the page so it can drop ones it cannot compute. */
  statCards: ReactNode;
  tabs: TimesheetTabDef[];
  activeTab: TimesheetTab;
  onTabChange: (tab: TimesheetTab) => void;
  onExport: () => void;
  onApproveSelected: () => void;

  periodLabel: string;
  onPeriodClick: () => void;
  locations: FilterOption[];
  locationId: string | null;
  onLocationChange: (id: string | null) => void;
  departments: FilterOption[];
  departmentId: string | null;
  onDepartmentChange: (id: string | null) => void;
  staff: FilterOption[];
  staffId: string | null;
  onStaffChange: (id: string | null) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  onFilters: () => void;

  rows: TimesheetRow[];
  selectedIds: string[];
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  onOpenRow: (id: string) => void;
  onRowMenu: (id: string) => void;
  showCost: boolean;
  showDoubleTime: boolean;
  emptyMessage: string;

  page: number;
  pageCount: number;
  rangeFrom: number;
  rangeTo: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;

  counts: TimesheetStatusCount[];
  summaryRangeLabel: string;
  onSummaryRangeClick: () => void;
  pending: PendingTimesheet[];
  pendingMoreCount: number;
  onViewAllPending: () => void;
  /** Omitted where no rule store exists to read from. */
  rules?: TimesheetRule[];
  onEditRules?: () => void;
  quickActions: QuickAction[];
  onViewGuide: () => void;
}

/**
 * `/app/timesheets` — worked hours, overtime and the approval queue
 * (design/Timesheets-Dashboard.png).
 *
 * Presentational only: every figure arrives already computed, so the live page
 * and the design preview render the identical tree.
 */
export function TimesheetsView(props: TimesheetsViewProps): JSX.Element {
  const selectedCount = props.selectedIds.length;

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold text-content dark:text-content-dark">
          Timesheets
        </h1>
        <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
          Track worked hours, overtime and approve timesheets.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              <TimesheetTabs
                tabs={props.tabs}
                active={props.activeTab}
                onChange={props.onTabChange}
              />
            </div>
          </div>

          <div className="mb-4">
            <TimesheetFilterBar
              periodLabel={props.periodLabel}
              onPeriodClick={props.onPeriodClick}
              locations={props.locations}
              locationId={props.locationId}
              onLocationChange={props.onLocationChange}
              departments={props.departments}
              departmentId={props.departmentId}
              onDepartmentChange={props.onDepartmentChange}
              staff={props.staff}
              staffId={props.staffId}
              onStaffChange={props.onStaffChange}
              status={props.statusFilter}
              onStatusChange={props.onStatusFilterChange}
              onFilters={props.onFilters}
            />
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {props.statCards}
          </div>

          <Card className="p-0">
            <TimesheetTable
              rows={props.rows}
              selectedIds={props.selectedIds}
              onToggleRow={props.onToggleRow}
              onToggleAll={props.onToggleAll}
              onOpenRow={props.onOpenRow}
              onRowMenu={props.onRowMenu}
              showCost={props.showCost}
              showDoubleTime={props.showDoubleTime}
              emptyMessage={props.emptyMessage}
            />
            {props.total > 0 && (
              <TimesheetPagination
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
            <TimesheetTipBanner
              title="Tip: Approve in bulk"
              body="Select multiple timesheets to approve them together, or export for payroll processing."
              actionLabel="View Timesheet Guide"
              onAction={props.onViewGuide}
            />
          </div>
        </div>

        <aside className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={props.onExport}
              className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-surface-border bg-surface px-3.5 text-sm font-semibold text-content transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
            >
              <Download size={16} aria-hidden="true" />
              Export
              <ChevronDown
                size={14}
                aria-hidden="true"
                className="text-content-muted dark:text-content-muted-dark"
              />
            </button>
            <Button
              onClick={props.onApproveSelected}
              disabled={selectedCount === 0}
              className="h-11 flex-1 whitespace-nowrap px-3 text-sm"
            >
              <Check size={16} aria-hidden="true" />
              Approve Selected ({selectedCount})
            </Button>
          </div>

          <TimesheetSummaryCard
            counts={props.counts}
            rangeLabel={props.summaryRangeLabel}
            onRangeClick={props.onSummaryRangeClick}
          />
          <PendingApprovalCard
            items={props.pending}
            moreCount={props.pendingMoreCount}
            onViewAll={props.onViewAllPending}
            onOpen={props.onOpenRow}
          />
          {props.rules && (
            <TimesheetRulesCard rules={props.rules} onEdit={props.onEditRules} />
          )}
          <QuickActionsCard actions={props.quickActions} />
        </aside>
      </div>
    </div>
  );
}
