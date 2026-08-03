import { useMemo, useState } from 'react';
import {
  CalendarCheck2,
  Clock,
  Copy,
  Lock,
  MessageSquareMore,
  PieChart,
  ArrowDown,
  ArrowUp,
  Users,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { NextAutoPublishCard } from '@/components/schedule/NextAutoPublishCard';
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
import { ShiftDetailsPanel } from '@/components/schedule/ShiftDetailsPanel';
import type { ScheduleView } from '@/lib/schedulePeriod';
import type {
  ScheduleChip,
  ScheduleDayTotal,
  ScheduleLocationGroup,
} from '@/lib/publishedSchedule';
import type { ShiftDetails } from '@/components/schedule/ShiftDetailsPanel';
import type { ScheduleRequest } from '@/components/schedule/OpenRequestsCard';
import type { ScheduleAnnouncement } from '@/components/schedule/ScheduleAnnouncementsCard';
import type { PublishEvent } from '@/components/schedule/PublishingHistoryCard';

/**
 * Design-loop preview only — `/app/schedule` needs a real Supabase session and
 * a published rota. This renders the same components against local mock data so
 * the screen can be screenshotted without auth or a database. Not wired to any
 * service call; see design/.loop/schedule-log.md.
 */

const DATES = [
  '2025-05-26',
  '2025-05-27',
  '2025-05-28',
  '2025-05-29',
  '2025-05-30',
  '2025-05-31',
  '2025-06-01',
];

const MORNING = '#86AC6A';
const EVENING = '#C48FD6';
const NIGHT = '#6CA0EB';

type Pattern = (0 | 1 | 2 | 3)[]; // 0 = day off, 1 = morning, 2 = evening, 3 = night

function chipsFor(
  rowId: string,
  pattern: Pattern,
  confirmedIndex?: number,
): Record<string, ScheduleChip[]> {
  const cells: Record<string, ScheduleChip[]> = {};
  pattern.forEach((slot, index) => {
    const date = DATES[index];
    if (!date || slot === 0) return;
    const spec =
      slot === 1
        ? { label: 'Morning', colour: MORNING, startTime: '07:00', endTime: '15:00' }
        : slot === 2
          ? { label: 'Evening', colour: EVENING, startTime: '15:00', endTime: '23:00' }
          : { label: 'Night', colour: NIGHT, startTime: '23:00', endTime: '07:00' };
    cells[date] = [
      {
        id: `${rowId}-${date}`,
        ...spec,
        unfilled: false,
        confirmed: index === confirmedIndex,
        // This page reproduces a static reference PNG, in which every chip is
        // coloured — so nothing here is "past", whatever today's date is.
        timeState: 'future',
      },
    ];
  });
  return cells;
}

const GROUPS: ScheduleLocationGroup[] = [
  {
    id: 'loc-sunshine',
    name: 'Sunnyvale Care Home',
    staffCount: 12,
    rows: [
      {
        id: 'staff-sarah',
        firstName: 'Sarah',
        lastName: 'Johnson',
        jobTitle: 'Senior Nurse',
        photoUrl: null,
        cells: chipsFor('sarah', [1, 1, 0, 2, 1, 1, 0], 1),
      },
      {
        id: 'staff-michael',
        firstName: 'Michael',
        lastName: 'Brown',
        jobTitle: 'Care Assistant',
        photoUrl: null,
        cells: chipsFor('michael', [2, 2, 1, 0, 2, 2, 2]),
      },
      {
        id: 'staff-emily',
        firstName: 'Emily',
        lastName: 'Davis',
        jobTitle: 'Care Assistant',
        photoUrl: null,
        cells: chipsFor('emily', [0, 1, 2, 2, 0, 1, 1]),
      },
      {
        id: 'staff-daniel',
        firstName: 'Daniel',
        lastName: 'Lee',
        jobTitle: 'Care Assistant',
        photoUrl: null,
        cells: chipsFor('daniel', [3, 3, 3, 0, 3, 3, 3]),
      },
    ],
  },
  { id: 'loc-riverside', name: 'Riverside House', staffCount: 10, rows: [] },
  { id: 'loc-oakview', name: 'Oakview Care Home', staffCount: 8, rows: [] },
];

const TOTALS: ScheduleDayTotal[] = [
  { date: '2025-05-26', staff: 12, shifts: 16, coverage: 92 },
  { date: '2025-05-27', staff: 13, shifts: 16, coverage: 94 },
  { date: '2025-05-28', staff: 12, shifts: 15, coverage: 90 },
  { date: '2025-05-29', staff: 12, shifts: 15, coverage: 93 },
  { date: '2025-05-30', staff: 12, shifts: 16, coverage: 91 },
  { date: '2025-05-31', staff: 11, shifts: 13, coverage: 85 },
  { date: '2025-06-01', staff: 11, shifts: 13, coverage: 85 },
];

const SELECTED_SHIFT: ShiftDetails = {
  id: 'sarah-2025-05-27',
  typeName: 'Morning',
  colour: MORNING,
  locationName: 'Sunnyvale Care Home',
  dateLabel: 'Tue, 27 May 2025',
  timeLabel: '07:00 – 15:00 (8h)',
  published: true,
  slots: 7,
  skills: ['Nursing', 'Manual Handling'],
  notes: 'Busy morning due to appointment clinic.',
  assigned: [
    {
      id: '1',
      firstName: 'Sarah',
      lastName: 'Johnson',
      photoUrl: null,
      roleCode: 'RN',
      confirmed: true,
    },
    {
      id: '2',
      firstName: 'Emily',
      lastName: 'Davis',
      photoUrl: null,
      roleCode: 'CA',
      confirmed: true,
    },
    {
      id: '3',
      firstName: 'Aisha',
      lastName: 'Patel',
      photoUrl: null,
      roleCode: 'RN',
      confirmed: true,
    },
    {
      id: '4',
      firstName: 'James',
      lastName: 'Wilson',
      photoUrl: null,
      roleCode: 'CA',
      confirmed: true,
    },
    {
      id: '5',
      firstName: 'Grace',
      lastName: 'Thompson',
      photoUrl: null,
      roleCode: 'CA',
      confirmed: true,
    },
    {
      id: '6',
      firstName: 'Liam',
      lastName: "O'Connor",
      photoUrl: null,
      roleCode: 'CA',
      confirmed: true,
    },
  ],
};

const REQUESTS: ScheduleRequest[] = [
  {
    id: 'req-1',
    kind: 'Annual Leave',
    name: 'Aisha Patel',
    photoUrl: null,
    dateLabel: '30 May 2025',
    status: 'pending',
  },
  {
    id: 'req-2',
    kind: 'Swap Request',
    name: 'James Wilson',
    photoUrl: null,
    counterpartName: 'Michael Brown',
    dateLabel: '27 May 2025',
    status: 'pending',
  },
  {
    id: 'req-3',
    kind: 'Overtime Request',
    name: "Liam O'Connor",
    photoUrl: null,
    dateLabel: '31 May 2025',
    status: 'pending',
  },
];

const ANNOUNCEMENTS: ScheduleAnnouncement[] = [
  {
    id: 'ann-1',
    title: 'Staff Meeting Reminder',
    body: "Don't forget our monthly staff meeting tomorrow at 10:00 in the main office.",
    timeLabel: '2 hours ago',
    tone: 'general',
  },
  {
    id: 'ann-2',
    title: 'New Training Available',
    body: 'Moving & Handling Refresher is now available. Please check your training.',
    timeLabel: '1 day ago',
    tone: 'training',
  },
];

const HISTORY: PublishEvent[] = [
  { id: 'pub-1', label: 'Published by James Davis', timeLabel: 'Today, 10:24' },
  { id: 'pub-2', label: 'Auto-published', timeLabel: '19 May 2025, 00:00' },
  { id: 'pub-3', label: 'Published by James Davis', timeLabel: '12 May 2025, 09:18' },
];

const RAIL_ACTION =
  'flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2';

export function SchedulePreviewPage(): JSX.Element {
  const [view, setView] = useState<ScheduleView>('week');
  const [grouping, setGrouping] = useState<ScheduleGrouping>('location');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [selectedChipId, setSelectedChipId] = useState<string | null>('sarah-2025-05-27');

  const locations = useMemo(
    () => GROUPS.map((group) => ({ id: group.id, name: group.name })),
    [],
  );

  const noop = (): void => {};

  return (
    <div className="min-h-screen bg-background px-5 py-6 dark:bg-background-dark">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-2xl font-bold text-content dark:text-content-dark">
            Published Schedule
            <Badge tone="success">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
              Live
            </Badge>
          </h1>
          <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
            This rota is published and visible to your team.
          </p>
        </div>
      </div>

      <div className="mb-4">
        <ScheduleToolbar
          periodLabel="26 May – 1 June 2025"
          locations={locations}
          locationId={locationId}
          onLocationChange={setLocationId}
          onPrev={noop}
          onNext={noop}
          onToday={noop}
          onFilters={noop}
          onExport={noop}
          onPrint={noop}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0">
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <ScheduleStatCard
              icon={Users}
              tint="text-primary"
              label="Total Staff"
              value="42"
              hint="Across 3 locations"
            />
            <ScheduleStatCard
              icon={CalendarCheck2}
              tint="text-content dark:text-content-dark"
              label="Total Shifts"
              value="84"
              hint="84 published"
            />
            <ScheduleStatCard
              icon={PieChart}
              tint="text-primary"
              label="Average Coverage"
              value="92%"
              hint={
                <>
                  Target: 90%
                  <Badge tone="success">
                    <ArrowUp size={11} aria-hidden="true" />
                    2%
                  </Badge>
                </>
              }
            />
            <ScheduleStatCard
              icon={Clock}
              tint="text-warning"
              label="Overtime (This Week)"
              value="18h 30m"
              hint={
                <>
                  12% vs last week
                  <Badge tone="danger">
                    <ArrowUp size={11} aria-hidden="true" />
                    2%
                  </Badge>
                </>
              }
            />
            <ScheduleStatCard
              icon={Wallet}
              tint="text-content dark:text-content-dark"
              label="Total Cost"
              value="£12,450"
              hint={
                <>
                  Budget: £13,500
                  <Badge tone="success">
                    <ArrowDown size={11} aria-hidden="true" />
                    8%
                  </Badge>
                </>
              }
            />
            <ScheduleStatCard
              icon={MessageSquareMore}
              tint="text-shift-violet"
              label="Open Requests"
              value="6"
              hint="3 leave • 2 swaps • 1 OT"
            />
          </div>

          <ScheduleViewBar
            view={view}
            onViewChange={setView}
            grouping={grouping}
            onGroupingChange={setGrouping}
            onSettings={noop}
          />

          <div className="mt-2.5 overflow-x-auto rounded-2xl border border-surface-border bg-surface shadow-sm dark:border-surface-border-dark dark:bg-surface-dark">
            <PublishedScheduleGrid
              dates={DATES}
              groups={GROUPS}
              totals={TOTALS}
              today="2025-05-27"
              selectedChipId={selectedChipId}
              onSelectChip={setSelectedChipId}
              initiallyCollapsed={['loc-riverside', 'loc-oakview']}
            />
          </div>

          <div className="mt-5">
            <PublishStatusBar
              publishedBy="Published by James Davis"
              publishedAtLabel="Today, 10:24"
              teamLastViewedLabel="2 minutes ago"
              onViewHistory={noop}
            />
          </div>

          {/* live-schedule.png stacks these in its rail; here the rail already
              holds the shift inspector, so they run under the grid instead. */}
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <OpenRequestsCard requests={REQUESTS} viewAllTo="/app/leave" />
            <ScheduleAnnouncementsCard
              announcements={ANNOUNCEMENTS}
              viewAllTo="/app/announcements"
            />
            <PublishingHistoryCard events={HISTORY} onViewAll={noop} />
          </div>
        </div>

        <aside className="space-y-3">
          <NextAutoPublishCard whenLabel="2 June 2025 at 00:00" />
          <ShiftDetailsPanel
            shift={SELECTED_SHIFT}
            onClose={() => setSelectedChipId(null)}
            onCopy={noop}
            onUnpublish={noop}
            onEditStaff={noop}
            onEditNotes={noop}
          />
          <div className="space-y-2">
            <button
              type="button"
              className={`${RAIL_ACTION} border-surface-border text-primary hover:bg-surface-subtle focus-visible:ring-primary dark:border-surface-border-dark dark:hover:bg-surface-subtle-dark`}
            >
              <Copy size={16} aria-hidden="true" />
              Copy This Week
            </button>
            <button
              type="button"
              className={`${RAIL_ACTION} border-danger/30 bg-danger/10 text-danger hover:bg-danger/15 focus-visible:ring-danger`}
            >
              <Lock size={16} aria-hidden="true" />
              Unpublish Rota
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
