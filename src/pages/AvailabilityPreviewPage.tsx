import { useState } from 'react';
import {
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Users,
} from 'lucide-react';
import { AvailabilityStatCard } from '@/components/availability/AvailabilityStatCard';
import { AvailabilityView } from '@/components/availability/AvailabilityView';
import type { AvailabilityRange } from '@/components/availability/AvailabilityViewBar';
import type { AvailabilityRule } from '@/components/availability/AvailabilityRulesCard';
import type { PendingAvailabilityRequest } from '@/components/availability/PendingRequestsCard';
import type {
  AvailabilityBreakdown,
  AvailabilityCellData,
  AvailabilityDay,
  AvailabilityRowData,
  AvailabilityState,
} from '@/lib/availabilityMatrix';

/**
 * Design-loop preview only, `/app/availability` needs a real Supabase session
 * and availability rows across the org. This renders the same components
 * against fixed mock data so the screen can be screenshotted without auth or a
 * database, reproducing design/Availability.png's figures.
 * See design/.loop/availability-log.md.
 */

const DAYS: AvailabilityDay[] = [
  { label: 'Mon 26 May', weekend: false, covered: 36, total: 42 },
  { label: 'Tue 27 May', weekend: false, covered: 38, total: 42 },
  { label: 'Wed 28 May', weekend: false, covered: 37, total: 42 },
  { label: 'Thu 29 May', weekend: false, covered: 36, total: 42 },
  { label: 'Fri 30 May', weekend: false, covered: 34, total: 42 },
  { label: 'Sat 31 May', weekend: true, covered: 26, total: 42 },
  { label: 'Sun 1 Jun', weekend: true, covered: 22, total: 42 },
];

const DAY = (state: AvailabilityState, timeRange?: string): AvailabilityCellData => ({
  state,
  timeRange,
});

const EARLY = '07:00-19:00';
const SHORT = '07:00-15:00';
const LATE = '15:00-23:00';
const NIGHT = '19:00-23:00';

const ROWS: AvailabilityRowData[] = [
  {
    id: 'sarah',
    firstName: 'Sarah',
    lastName: 'Johnson',
    payrollId: 'RN12345',
    role: 'Senior Nurse',
    roleCode: 'RN',
    cells: [
      DAY('available', EARLY),
      DAY('available', EARLY),
      DAY('available', EARLY),
      DAY('available', EARLY),
      DAY('available', EARLY),
      DAY('unavailable'),
      DAY('unavailable'),
    ],
  },
  {
    id: 'michael',
    firstName: 'Michael',
    lastName: 'Brown',
    payrollId: 'CA98765',
    role: 'Care Assistant',
    roleCode: 'CA',
    cells: [
      DAY('partial', SHORT),
      DAY('available', SHORT),
      DAY('unavailable'),
      DAY('available', SHORT),
      DAY('partial', LATE),
      DAY('available', SHORT),
      DAY('unavailable'),
    ],
  },
  {
    id: 'emily',
    firstName: 'Emily',
    lastName: 'Davis',
    payrollId: 'CA11223',
    role: 'Care Assistant',
    roleCode: 'CA',
    cells: [
      DAY('available', SHORT),
      DAY('available', SHORT),
      DAY('available', SHORT),
      DAY('unavailable'),
      DAY('available', SHORT),
      DAY('partial', LATE),
      DAY('unavailable'),
    ],
  },
  {
    id: 'daniel',
    firstName: 'Daniel',
    lastName: 'Lee',
    payrollId: 'CA33445',
    role: 'Care Assistant',
    roleCode: 'CA',
    cells: [
      DAY('preference', NIGHT),
      DAY('preference', NIGHT),
      DAY('unavailable'),
      DAY('preference', NIGHT),
      DAY('preference', NIGHT),
      DAY('unavailable'),
      DAY('unavailable'),
    ],
  },
  {
    id: 'aisha',
    firstName: 'Aisha',
    lastName: 'Patel',
    payrollId: 'RN55667',
    role: 'Senior Nurse',
    roleCode: 'RN',
    cells: [
      DAY('available', EARLY),
      DAY('available', EARLY),
      DAY('partial', SHORT),
      DAY('available', EARLY),
      DAY('available', EARLY),
      DAY('available', EARLY),
      DAY('partial', SHORT),
    ],
  },
  {
    id: 'james',
    firstName: 'James',
    lastName: 'Wilson',
    payrollId: 'CA77889',
    role: 'Care Assistant',
    roleCode: 'CA',
    cells: [
      DAY('available', SHORT),
      DAY('unavailable'),
      DAY('available', SHORT),
      DAY('available', SHORT),
      DAY('unavailable'),
      DAY('available', SHORT),
      DAY('available', SHORT),
    ],
  },
  {
    id: 'grace',
    firstName: 'Grace',
    lastName: 'Thompson',
    payrollId: 'RN99001',
    role: 'Senior Nurse',
    roleCode: 'RN',
    cells: [
      DAY('available', EARLY),
      DAY('available', EARLY),
      DAY('available', EARLY),
      DAY('available', EARLY),
      DAY('unavailable'),
      DAY('unavailable'),
      DAY('unavailable'),
    ],
  },
  {
    id: 'liam',
    firstName: 'Liam',
    lastName: "O'Connor",
    payrollId: 'CA22334',
    role: 'Care Assistant',
    roleCode: 'CA',
    cells: [
      DAY('partial', SHORT),
      DAY('available', SHORT),
      DAY('available', SHORT),
      DAY('partial', SHORT),
      DAY('available', SHORT),
      DAY('partial', LATE),
      DAY('unavailable'),
    ],
  },
];

const SEGMENTS: AvailabilityBreakdown[] = [
  { state: 'available', label: 'Available', percent: 43, count: 120 },
  { state: 'partial', label: 'Partially Available', percent: 38, count: 106 },
  { state: 'unavailable', label: 'Unavailable', percent: 19, count: 53 },
  { state: 'preference', label: 'Preference Only', percent: 6, count: 16 },
  { state: 'pending', label: 'Pending', percent: 3, count: 8 },
];

const LEGEND: { state: AvailabilityState; label: string }[] = [
  { state: 'available', label: 'Available' },
  { state: 'partial', label: 'Partially Available' },
  { state: 'unavailable', label: 'Unavailable' },
  { state: 'preference', label: 'Preference Only' },
  { state: 'pending', label: 'Pending' },
];

const PENDING: PendingAvailabilityRequest[] = [
  {
    id: 'p1',
    firstName: 'Emily',
    lastName: 'Davis',
    summary: 'Change 31 May',
    detail: '15:00-23:00',
    statusLabel: 'Pending',
  },
  {
    id: 'p2',
    firstName: 'Aisha',
    lastName: 'Patel',
    summary: 'Another day off',
    detail: '1 June',
    statusLabel: 'Pending',
  },
  {
    id: 'p3',
    firstName: 'Daniel',
    lastName: 'Lee',
    summary: 'Add preference',
    detail: 'Mon, Wed, Fri',
    statusLabel: 'Pending',
  },
];

const RULES: AvailabilityRule[] = [
  { id: 'consecutive', label: 'Max consecutive days', value: '5 days' },
  { id: 'rest', label: 'Min rest between shifts', value: '11 hours' },
  { id: 'notice', label: 'Preferred notice period', value: '7 days' },
  { id: 'weekend', label: 'Weekend availability', value: 'Required' },
];

const noop = (): void => undefined;

export function AvailabilityPreviewPage(): JSX.Element {
  const [range, setRange] = useState<AvailabilityRange>('week');
  const [showPreferences, setShowPreferences] = useState(true);

  const statCards = (
    <>
      <AvailabilityStatCard
        icon={Users}
        tint="bg-primary/10 text-primary dark:bg-primary/15"
        label="Total Staff"
        value="42"
        hint="Across 3 locations"
      />
      <AvailabilityStatCard
        icon={CircleCheck}
        tint="bg-success/10 text-success"
        label="Fully Available"
        value="18"
        hint="43% of team"
      />
      <AvailabilityStatCard
        icon={Clock}
        tint="bg-warning/15 text-warning"
        label="Partially Available"
        value="16"
        hint="38% of team"
      />
      <AvailabilityStatCard
        icon={CircleX}
        tint="bg-danger/10 text-danger"
        label="Unavailable"
        value="8"
        hint="19% of team"
      />
      <AvailabilityStatCard
        icon={CalendarClock}
        tint="bg-primary/10 text-primary dark:bg-primary/15"
        label="Pending Requests"
        value="6"
        hint="Needs approval"
      />
      <AvailabilityStatCard
        icon={CircleAlert}
        tint="bg-danger/10 text-danger"
        label="Conflicts"
        value="2"
        hint="Requires attention"
      />
    </>
  );

  return (
    <div className="min-h-screen bg-background px-5 py-6 dark:bg-background-dark">
      <AvailabilityView
        statCards={statCards}
        periodLabel="26 May-1 June 2025"
        locationLabel="All Locations"
        onPrev={noop}
        onNext={noop}
        onToday={noop}
        onPeriodClick={noop}
        onLocationClick={noop}
        onFilters={noop}
        onExport={noop}
        onAdd={noop}
        range={range}
        onRangeChange={setRange}
        showPreferences={showPreferences}
        onShowPreferencesChange={setShowPreferences}
        legend={LEGEND}
        days={DAYS}
        rows={ROWS}
        emptyMessage="No staff match these filters."
        page={1}
        pageCount={6}
        rangeFrom={1}
        rangeTo={8}
        total={42}
        pageSize={10}
        onPageChange={noop}
        onPageSizeChange={noop}
        segments={SEGMENTS}
        summaryCentreTop="Next"
        summaryCentreBottom="7 days"
        pending={PENDING}
        pendingMoreCount={3}
        onViewAllPending={noop}
        rules={RULES}
        onEditRules={noop}
        onSendReminder={noop}
      />
    </div>
  );
}
