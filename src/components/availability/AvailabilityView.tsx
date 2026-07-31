import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { AvailabilityMatrix } from '@/components/availability/AvailabilityMatrix';
import { AvailabilityPagination } from '@/components/availability/AvailabilityPagination';
import { AvailabilityRulesCard } from '@/components/availability/AvailabilityRulesCard';
import { AvailabilitySummaryCard } from '@/components/availability/AvailabilitySummaryCard';
import { AvailabilityTipCard } from '@/components/availability/AvailabilityTipCard';
import { AvailabilityToolbar } from '@/components/availability/AvailabilityToolbar';
import { AvailabilityViewBar } from '@/components/availability/AvailabilityViewBar';
import { PendingRequestsCard } from '@/components/availability/PendingRequestsCard';
import type { AvailabilityRange } from '@/components/availability/AvailabilityViewBar';
import type { AvailabilityRule } from '@/components/availability/AvailabilityRulesCard';
import type { PendingAvailabilityRequest } from '@/components/availability/PendingRequestsCard';
import type {
  AvailabilityBreakdown,
  AvailabilityDay,
  AvailabilityRowData,
  AvailabilityState,
} from '@/lib/availabilityMatrix';

export interface AvailabilityViewProps {
  /** Six tiles, built by the page so it can drop any it cannot compute. */
  statCards: ReactNode;

  periodLabel: string;
  locationLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onPeriodClick: () => void;
  onLocationClick: () => void;
  onFilters: () => void;
  onExport: () => void;
  onAdd: () => void;

  range: AvailabilityRange;
  onRangeChange: (range: AvailabilityRange) => void;
  showPreferences: boolean;
  onShowPreferencesChange: (next: boolean) => void;
  legend: { state: AvailabilityState; label: string }[];

  days: AvailabilityDay[];
  rows: AvailabilityRowData[];
  onSelectCell?: (rowId: string, dayIndex: number) => void;
  emptyMessage: string;

  page: number;
  pageCount: number;
  rangeFrom: number;
  rangeTo: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;

  segments: AvailabilityBreakdown[];
  summaryCentreTop: string;
  summaryCentreBottom: string;
  pending: PendingAvailabilityRequest[];
  pendingMoreCount: number;
  onViewAllPending: () => void;
  onOpenPending?: (id: string) => void;
  rules: AvailabilityRule[];
  onEditRules: () => void;
  onSendReminder: () => void;
}

/**
 * `/app/availability` — the team availability matrix
 * (design/Availability.png).
 *
 * Presentational only: every figure arrives already computed, so the live page
 * and the design preview render an identical tree.
 */
export function AvailabilityView(props: AvailabilityViewProps): JSX.Element {
  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold text-content dark:text-content-dark">
          Availability
        </h1>
        <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
          View and manage staff availability and working preferences.
        </p>
      </div>

      <div className="mb-4">
        <AvailabilityToolbar
          periodLabel={props.periodLabel}
          locationLabel={props.locationLabel}
          onPrev={props.onPrev}
          onNext={props.onNext}
          onToday={props.onToday}
          onPeriodClick={props.onPeriodClick}
          onLocationClick={props.onLocationClick}
          onFilters={props.onFilters}
          onExport={props.onExport}
          onAdd={props.onAdd}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0">
          <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {props.statCards}
          </div>

          <div className="mb-4">
            <AvailabilityViewBar
              range={props.range}
              onRangeChange={props.onRangeChange}
              showPreferences={props.showPreferences}
              onShowPreferencesChange={props.onShowPreferencesChange}
              legend={props.legend}
            />
          </div>

          <Card className="rounded-xl p-0">
            <AvailabilityMatrix
              days={props.days}
              rows={props.rows}
              showPreferences={props.showPreferences}
              onSelectCell={props.onSelectCell}
              emptyMessage={props.emptyMessage}
            />
            {props.total > 0 && (
              <AvailabilityPagination
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
        </div>

        <aside className="space-y-4">
          <AvailabilitySummaryCard
            segments={props.segments}
            centreTop={props.summaryCentreTop}
            centreBottom={props.summaryCentreBottom}
          />
          <PendingRequestsCard
            requests={props.pending}
            moreCount={props.pendingMoreCount}
            onViewAll={props.onViewAllPending}
            onOpen={props.onOpenPending}
          />
          <AvailabilityRulesCard rules={props.rules} onEdit={props.onEditRules} />
          <AvailabilityTipCard
            title="Keeping availability up to date"
            body="Encourage your team to keep their availability current for better rota accuracy."
            actionLabel="Send reminder"
            onAction={props.onSendReminder}
          />
        </aside>
      </div>
    </div>
  );
}
