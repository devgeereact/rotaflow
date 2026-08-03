import {
  CalendarCheck2,
  Clock,
  Hourglass,
  MessageSquareMore,
  PieChart,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { OpenRequestsCard } from '@/components/schedule/OpenRequestsCard';
import { PublishStatusBar } from '@/components/schedule/PublishStatusBar';
import { PublishedScheduleGrid } from '@/components/schedule/PublishedScheduleGrid';
import { PublishingHistoryCard } from '@/components/schedule/PublishingHistoryCard';
import { ScheduleAnnouncementsCard } from '@/components/schedule/ScheduleAnnouncementsCard';
import { ScheduleStatCard } from '@/components/schedule/ScheduleStatCard';
import { ScheduleToolbar } from '@/components/schedule/ScheduleToolbar';
import {
  ScheduleViewBar,
  type ScheduleGrouping,
} from '@/components/schedule/ScheduleViewBar';
import {
  ShiftDetailsPanel,
  type ShiftDetails,
} from '@/components/schedule/ShiftDetailsPanel';
import type { ScheduleView } from '@/lib/schedulePeriod';
import type { ScheduleDayTotal, ScheduleLocationGroup } from '@/lib/publishedSchedule';
import type { ScheduleLocationOption } from '@/components/schedule/ScheduleToolbar';
import type { ScheduleRequest } from '@/components/schedule/OpenRequestsCard';
import type { ScheduleAnnouncement } from '@/components/schedule/ScheduleAnnouncementsCard';
import type { PublishEvent } from '@/components/schedule/PublishingHistoryCard';
import type { TabItem } from '@/components/ui/Tabs';

export interface ScheduleSummary {
  totalStaff: number;
  totalShifts: number;
  /** Mean daily coverage, 0–100. `null` when the period has no shifts. */
  averageCoverage: number | null;
  scheduledHours: string;
  /** Hours beyond contracted `weekly_hours`, week view only. */
  overtime: string | null;
  openRequests: number;
  openRequestsBreakdown: string;
  locationCount: number;
}

interface PublishedScheduleViewProps {
  periodLabel: string;
  view: ScheduleView;
  onViewChange: (view: ScheduleView) => void;
  grouping: ScheduleGrouping;
  onGroupingChange: (grouping: ScheduleGrouping) => void;
  locations: ScheduleLocationOption[];
  locationId: string | null;
  onLocationChange: (id: string | null) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onExport: () => void;
  onPrint: () => void;
  onFilters: () => void;
  onSettings: () => void;
  summary: ScheduleSummary;
  dates: string[];
  today: string;
  groups: ScheduleLocationGroup[];
  totals: ScheduleDayTotal[];
  selectedChipId: string | null;
  onSelectChip: (chipId: string) => void;
  selectedShift: ShiftDetails | null;
  onCloseShift: () => void;
  published: boolean;
  publishedAtLabel: string | null;
  onViewHistory: () => void;
  /** Workspace section tabs, resolved against the viewer's role. */
  tabs: TabItem[];
  requests: ScheduleRequest[];
  announcements: ScheduleAnnouncement[];
  history: PublishEvent[];
  /** Rendered instead of the grid while shifts are loading or none exist. */
  gridPlaceholder?: string;
}

/**
 * The manager's published-rota screen — design/published-schedule.png,
 * design/live-schedule.png and design/Schedule-dashboard.png merged into one
 * view (see design/.loop/schedule-log.md).
 *
 * Presentational only: every number arrives already computed, so the same tree
 * serves the live `/app/schedule` page and the design preview route.
 */
export function PublishedScheduleView(props: PublishedScheduleViewProps): JSX.Element {
  const { summary } = props;

  return (
    <div>
      {/* Same workspace as the builder — see WorkspaceHeader. The Live badge
          rides in the actions slot so it stays beside the title. */}
      <WorkspaceHeader
        title="Rota"
        subtitle={
          props.published
            ? 'This rota is published and visible to your team.'
            : 'Nothing is published for this period yet. Draft rotas stay hidden from your team.'
        }
        tabs={props.tabs}
        actions={
          props.published ? (
            <Badge tone="success">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
              Live
            </Badge>
          ) : undefined
        }
      />

      <div className="mb-4">
        <ScheduleToolbar
          periodLabel={props.periodLabel}
          locations={props.locations}
          locationId={props.locationId}
          onLocationChange={props.onLocationChange}
          onPrev={props.onPrev}
          onNext={props.onNext}
          onToday={props.onToday}
          onFilters={props.onFilters}
          onExport={props.onExport}
          onPrint={props.onPrint}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0">
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <ScheduleStatCard
              icon={Users}
              tint="text-primary"
              label="Total Staff"
              value={String(summary.totalStaff)}
              hint={`Across ${summary.locationCount} ${summary.locationCount === 1 ? 'location' : 'locations'}`}
            />
            <ScheduleStatCard
              icon={CalendarCheck2}
              tint="text-content dark:text-content-dark"
              label="Total Shifts"
              value={String(summary.totalShifts)}
              hint="Published only"
            />
            <ScheduleStatCard
              icon={PieChart}
              tint="text-primary"
              label="Average Coverage"
              value={
                summary.averageCoverage === null ? '—' : `${summary.averageCoverage}%`
              }
              hint="Slots filled"
            />
            <ScheduleStatCard
              icon={Hourglass}
              tint="text-info"
              label="Scheduled Hours"
              value={summary.scheduledHours}
              hint="Net of breaks"
            />
            <ScheduleStatCard
              icon={Clock}
              tint="text-warning"
              label="Overtime (This Week)"
              value={summary.overtime ?? '—'}
              hint={
                summary.overtime === null ? 'Week view only' : 'Beyond contracted hours'
              }
            />
            <ScheduleStatCard
              icon={MessageSquareMore}
              tint="text-shift-violet"
              label="Open Requests"
              value={String(summary.openRequests)}
              hint={summary.openRequestsBreakdown}
            />
          </div>

          <ScheduleViewBar
            view={props.view}
            onViewChange={props.onViewChange}
            grouping={props.grouping}
            onGroupingChange={props.onGroupingChange}
            onSettings={props.onSettings}
          />

          <div className="mt-2.5 overflow-x-auto rounded-2xl border border-surface-border bg-surface shadow-sm dark:border-surface-border-dark dark:bg-surface-dark">
            {props.gridPlaceholder ? (
              <p className="p-6 text-sm text-content-muted dark:text-content-muted-dark">
                {props.gridPlaceholder}
              </p>
            ) : (
              <PublishedScheduleGrid
                dates={props.dates}
                groups={props.groups}
                totals={props.totals}
                today={props.today}
                selectedChipId={props.selectedChipId}
                onSelectChip={props.onSelectChip}
              />
            )}
          </div>

          <div className="mt-5">
            <PublishStatusBar
              publishedBy={null}
              publishedAtLabel={props.publishedAtLabel}
              teamLastViewedLabel={null}
              onViewHistory={props.onViewHistory}
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <OpenRequestsCard requests={props.requests} viewAllTo="/app/leave" />
            <ScheduleAnnouncementsCard
              announcements={props.announcements}
              viewAllTo="/app/announcements"
            />
            <PublishingHistoryCard events={props.history} />
          </div>
        </div>

        {/* No "Next auto-publish" tile here: scheduled publishing is in the
            reference but not in the product, and pointing it at the *last*
            publish time would be a lie. */}
        <aside className="space-y-3">
          {props.selectedShift ? (
            <ShiftDetailsPanel shift={props.selectedShift} onClose={props.onCloseShift} />
          ) : (
            <div className="rounded-2xl border border-dashed border-surface-border p-6 text-center text-sm text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
              Select a shift to see who is on it.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
