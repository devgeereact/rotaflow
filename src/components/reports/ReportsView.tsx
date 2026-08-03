import { ListFilter, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { RecentReportsCard } from '@/components/reports/RecentReportsCard';
import { ReportsFilterBar } from '@/components/reports/ReportsFilterBar';
import { ReportsOverviewCard } from '@/components/reports/ReportsOverviewCard';
import { ReportsQuickActionsCard } from '@/components/reports/ReportsQuickActionsCard';
import { ReportsTable } from '@/components/reports/ReportsTable';
import { ReportsTabs } from '@/components/reports/ReportsTabs';
import { ReportsTipBanner } from '@/components/reports/ReportsTipBanner';
import { reportsTabId, type ReportRow } from '@/lib/reportRows';
import type { ReportsTab, ReportsTabDef } from '@/components/reports/ReportsTabs';
import type { ReportFilterOption } from '@/components/reports/ReportsFilterBar';
import type { ReportsOverviewSegment } from '@/components/reports/ReportsOverviewCard';
import type { RecentReport } from '@/components/reports/RecentReportsCard';
import type { ReportQuickAction } from '@/components/reports/ReportsQuickActionsCard';

export interface ReportsViewProps {
  /** The workforce-trends charts, rendered above the report catalogue. */
  analytics?: ReactNode;
  tabs: ReportsTabDef[];
  activeTab: ReportsTab;
  onTabChange: (tab: ReportsTab) => void;
  /** Omitted where no saved-filter panel exists to open. */
  onFilters?: () => void;
  /** Omitted where no report builder exists to open. */
  onCustomReport?: () => void;

  search: string;
  onSearchChange: (value: string) => void;
  categories: ReportFilterOption[];
  category: string;
  onCategoryChange: (value: string) => void;
  locations?: ReportFilterOption[];
  location?: string;
  onLocationChange?: (value: string) => void;
  formats: ReportFilterOption[];
  format: string;
  onFormatChange: (value: string) => void;
  favouritesOnly: boolean;
  onFavouritesOnlyChange: (value: boolean) => void;

  rows: ReportRow[];
  onToggleFavourite: (id: string) => void;
  onRun: (id: string) => void;
  onDownload: (id: string) => void;
  onRowMenu?: (id: string) => void;
  runningId: string | null;
  emptyMessage: string;

  overview: ReportsOverviewSegment[];
  overviewTotal: number;
  overviewRanges: ReportFilterOption[];
  overviewRange: string;
  onOverviewRangeChange: (value: string) => void;
  overviewEmptyMessage: string;

  recent: RecentReport[];
  onViewAllRecent?: () => void;
  recentEmptyMessage: string;

  quickActions: ReportQuickAction[];

  tipTitle: string;
  tipBody: string;
  tipActionLabel: string;
  tipActionIcon: LucideIcon;
  onTipAction: () => void;
}

const PANEL_ID = 'reports-panel';

/**
 * `/app/reports` — the reporting workspace: the report catalogue with its
 * filters and per-row run/download actions, plus a rail of overview, recent
 * runs and shortcuts (design/Reports-Dashboard.png).
 *
 * Presentational only: every figure arrives already computed, so the live page
 * and the design preview render the identical tree.
 */
export function ReportsView(props: ReportsViewProps): JSX.Element {
  const showRailActions = Boolean(props.onFilters || props.onCustomReport);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-page-title font-semibold text-content dark:text-content-dark">
          Reports
        </h1>
        <p className="mt-1 text-[0.95rem] font-medium text-content-muted dark:text-content-muted-dark">
          View, run and export scheduling and workforce reports.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0">
          <ReportsTabs
            tabs={props.tabs}
            active={props.activeTab}
            onChange={props.onTabChange}
            panelId={PANEL_ID}
          />

          <div
            id={PANEL_ID}
            role="tabpanel"
            aria-labelledby={reportsTabId(props.activeTab)}
          >
            {/* Charts sit above the catalogue: §17 asks for summary cards,
                charts, tables and downloads, and the trend is the thing a
                manager reads before deciding which export to run. */}
            <div className="mt-6">{props.analytics}</div>
            <div className="mb-5 mt-6">
              <ReportsFilterBar
                search={props.search}
                onSearchChange={props.onSearchChange}
                categories={props.categories}
                category={props.category}
                onCategoryChange={props.onCategoryChange}
                locations={props.locations}
                location={props.location}
                onLocationChange={props.onLocationChange}
                formats={props.formats}
                format={props.format}
                onFormatChange={props.onFormatChange}
                favouritesOnly={props.favouritesOnly}
                onFavouritesOnlyChange={props.onFavouritesOnlyChange}
              />
            </div>

            <Card className="p-0">
              <ReportsTable
                rows={props.rows}
                onToggleFavourite={props.onToggleFavourite}
                onRun={props.onRun}
                onDownload={props.onDownload}
                onRowMenu={props.onRowMenu}
                runningId={props.runningId}
                emptyMessage={props.emptyMessage}
              />
            </Card>
          </div>

          <div className="mt-4">
            <ReportsTipBanner
              title={props.tipTitle}
              body={props.tipBody}
              actionLabel={props.tipActionLabel}
              actionIcon={props.tipActionIcon}
              onAction={props.onTipAction}
            />
          </div>
        </div>

        <aside className="space-y-3">
          {showRailActions && (
            <div className="flex items-center gap-5 pb-2.5">
              {props.onFilters && (
                <Button
                  variant="secondary"
                  onClick={props.onFilters}
                  className="h-11 w-32 shrink-0 px-4 text-sm"
                >
                  <ListFilter size={16} aria-hidden="true" />
                  Filters
                </Button>
              )}
              {props.onCustomReport && (
                <Button
                  onClick={props.onCustomReport}
                  className="h-11 flex-1 whitespace-nowrap px-4 text-sm"
                >
                  <Plus size={17} aria-hidden="true" />
                  Custom Report
                </Button>
              )}
            </div>
          )}

          <ReportsOverviewCard
            segments={props.overview}
            total={props.overviewTotal}
            ranges={props.overviewRanges}
            range={props.overviewRange}
            onRangeChange={props.onOverviewRangeChange}
            emptyMessage={props.overviewEmptyMessage}
          />
          <RecentReportsCard
            items={props.recent}
            onViewAll={props.onViewAllRecent}
            emptyMessage={props.recentEmptyMessage}
          />
          <ReportsQuickActionsCard actions={props.quickActions} />
        </aside>
      </div>
    </div>
  );
}
