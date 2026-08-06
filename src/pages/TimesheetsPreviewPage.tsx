import { useState } from 'react';
import {
  ArrowUp,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock,
  Calculator,
  Settings,
  Timer,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { TimesheetStatCard } from '@/components/timesheets/TimesheetStatCard';
import { TimesheetsView } from '@/components/timesheets/TimesheetsView';
import type { TimesheetRow, TimesheetStatusCount } from '@/lib/timesheetRows';
import type { TimesheetTab } from '@/components/timesheets/TimesheetTabs';
import type { PendingTimesheet } from '@/components/timesheets/PendingApprovalCard';
import type { TimesheetRule } from '@/components/timesheets/TimesheetRulesCard';
import type { QuickAction } from '@/components/timesheets/QuickActionsCard';

/**
 * Design-loop preview only, `/app/timesheets` needs a real Supabase session
 * and clock events. This renders the same components against local mock data so
 * the screen can be screenshotted without auth or a database. Not wired to any
 * service call; see design/.loop/timesheets-log.md.
 */

const WEEK = '26 May-1 Jun 2025';

const ROWS: TimesheetRow[] = [
  {
    id: 'ts-emily',
    firstName: 'Emily',
    lastName: 'Davis',
    jobTitle: 'Care Assistant',
    photoUrl: null,
    weekLabel: WEEK,
    shifts: 4,
    regularHours: '30.00',
    overtimeHours: '2.00',
    doubleTimeHours: '0.00',
    totalHours: '32.00',
    totalCost: '£512.00',
    status: 'pending',
  },
  {
    id: 'ts-daniel',
    firstName: 'Daniel',
    lastName: 'Lee',
    jobTitle: 'Care Assistant',
    photoUrl: null,
    weekLabel: WEEK,
    shifts: 5,
    regularHours: '37.50',
    overtimeHours: '5.00',
    doubleTimeHours: '0.00',
    totalHours: '42.50',
    totalCost: '£701.25',
    status: 'pending',
  },
  {
    id: 'ts-aisha',
    firstName: 'Aisha',
    lastName: 'Patel',
    jobTitle: 'Senior Nurse',
    photoUrl: null,
    weekLabel: WEEK,
    shifts: 4,
    regularHours: '30.00',
    overtimeHours: '0.50',
    doubleTimeHours: '6.00',
    totalHours: '36.50',
    totalCost: '£621.50',
    status: 'submitted',
  },
  {
    id: 'ts-sarah',
    firstName: 'Sarah',
    lastName: 'Johnson',
    jobTitle: 'Senior Nurse',
    photoUrl: null,
    weekLabel: WEEK,
    shifts: 4,
    regularHours: '30.00',
    overtimeHours: '2.00',
    doubleTimeHours: '0.00',
    totalHours: '32.00',
    totalCost: '£560.00',
    status: 'approved',
  },
  {
    id: 'ts-michael',
    firstName: 'Michael',
    lastName: 'Brown',
    jobTitle: 'Care Assistant',
    photoUrl: null,
    weekLabel: WEEK,
    shifts: 5,
    regularHours: '37.50',
    overtimeHours: '0.00',
    doubleTimeHours: '0.00',
    totalHours: '37.50',
    totalCost: '£637.50',
    status: 'approved',
  },
  {
    id: 'ts-grace',
    firstName: 'Grace',
    lastName: 'Thompson',
    jobTitle: 'Senior Nurse',
    photoUrl: null,
    weekLabel: WEEK,
    shifts: 4,
    regularHours: '30.00',
    overtimeHours: '1.00',
    doubleTimeHours: '2.00',
    totalHours: '33.00',
    totalCost: '£561.00',
    status: 'rejected',
  },
  {
    id: 'ts-james',
    firstName: 'James',
    lastName: 'Wilson',
    jobTitle: 'Care Assistant',
    photoUrl: null,
    weekLabel: WEEK,
    shifts: 3,
    regularHours: '22.50',
    overtimeHours: '0.00',
    doubleTimeHours: '0.00',
    totalHours: '22.50',
    totalCost: '£382.50',
    status: 'submitted',
  },
  {
    id: 'ts-liam',
    firstName: 'Liam',
    lastName: "O'Connor",
    jobTitle: 'Care Assistant',
    photoUrl: null,
    weekLabel: WEEK,
    shifts: 4,
    regularHours: '30.00',
    overtimeHours: '1.50',
    doubleTimeHours: '0.00',
    totalHours: '31.50',
    totalCost: '£535.50',
    status: 'pending',
  },
];

const COUNTS: TimesheetStatusCount[] = [
  { status: 'pending', label: 'Pending Approval', count: 8 },
  { status: 'submitted', label: 'Submitted', count: 8 },
  { status: 'approved', label: 'Approved', count: 12 },
  { status: 'rejected', label: 'Rejected', count: 2 },
  { status: 'cancelled', label: 'Cancelled', count: 2 },
];

const PENDING: PendingTimesheet[] = [
  {
    id: 'ts-emily',
    firstName: 'Emily',
    lastName: 'Davis',
    photoUrl: null,
    submittedLabel: 'Submitted today, 09:15',
    hoursLabel: '32.00 hours',
  },
  {
    id: 'ts-daniel',
    firstName: 'Daniel',
    lastName: 'Lee',
    photoUrl: null,
    submittedLabel: 'Submitted today, 08:47',
    hoursLabel: '42.50 hours',
  },
  {
    id: 'ts-liam',
    firstName: 'Liam',
    lastName: "O'Connor",
    photoUrl: null,
    submittedLabel: 'Submitted yesterday, 17:30',
    hoursLabel: '31.50 hours',
  },
];

const RULES: TimesheetRule[] = [
  { id: 'due', label: 'Timesheets due by', value: 'Sunday, 23:59' },
  { id: 'min', label: 'Min shift duration', value: '15 minutes' },
  { id: 'round', label: 'Rounding rule', value: 'Nearest 15 minutes' },
  { id: 'ot', label: 'Overtime threshold', value: '37.5 hours / week' },
];

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'calendar',
    icon: CalendarDays,
    label: 'Team Timesheet Calendar',
    to: '/app/schedule',
  },
  { id: 'report', icon: BarChart3, label: 'Timesheet Report', to: '/app/reports' },
  { id: 'settings', icon: Settings, label: 'Timesheet Settings', to: '/app/settings' },
];

export function TimesheetsPreviewPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<TimesheetTab>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>(['ts-emily', 'ts-daniel']);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const noop = (): void => {};

  const toggleRow = (id: string): void =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((rowId) => rowId !== id) : [...prev, id],
    );

  return (
    <div className="min-h-screen bg-background px-6 py-6 dark:bg-background-dark">
      <TimesheetsView
        statCards={
          <>
            <TimesheetStatCard
              icon={Clock}
              tint="bg-primary/10 text-primary"
              label="Total Hours"
              value="412.50"
              hint={
                <>
                  vs last week 398.75
                  <Badge tone="success" className="px-1.5 py-0 text-[0.62rem]">
                    <ArrowUp size={11} aria-hidden="true" />
                    3.5%
                  </Badge>
                </>
              }
            />
            <TimesheetStatCard
              icon={Timer}
              tint="bg-info/10 text-info"
              label="Regular Hours"
              value="356.00"
              hint="86% of total"
            />
            <TimesheetStatCard
              icon={Clock}
              tint="bg-warning/15 text-warning"
              label="Overtime Hours"
              value="36.50"
              hint="8.8% of total"
            />
            <TimesheetStatCard
              icon={XCircle}
              tint="bg-danger/10 text-danger"
              label="Double Time Hours"
              value="20.00"
              hint="4.9% of total"
            />
            <TimesheetStatCard
              icon={Calculator}
              tint="bg-shift-violet/15 text-shift-violet"
              label="Total Cost"
              value="£6,582.75"
              hint={
                <>
                  vs last week £6,102.30
                  <Badge tone="success" className="px-1.5 py-0 text-[0.62rem]">
                    <ArrowUp size={11} aria-hidden="true" />
                    7.9%
                  </Badge>
                </>
              }
            />
            <TimesheetStatCard
              icon={CheckCircle2}
              tint="bg-success/10 text-success"
              label="Approved"
              value="24"
              hint="of 32 timesheets"
            />
          </>
        }
        tabs={[
          { value: 'all', label: 'All Timesheets' },
          { value: 'pending', label: 'Pending Approval', count: 8 },
          { value: 'approved', label: 'Approved' },
          { value: 'submitted', label: 'Submitted' },
          { value: 'rejected', label: 'Rejected' },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onExport={noop}
        onApproveSelected={noop}
        periodLabel="26 May-1 June 2025"
        onPeriodClick={noop}
        locations={[
          { id: 'loc-sunnyvale', name: 'Sunnyvale Care Home' },
          { id: 'loc-riverside', name: 'Riverside House' },
        ]}
        locationId={locationId}
        onLocationChange={setLocationId}
        departments={[{ id: 'dep-care', name: 'Care' }]}
        departmentId={departmentId}
        onDepartmentChange={setDepartmentId}
        staff={ROWS.map((row) => ({
          id: row.id,
          name: `${row.firstName} ${row.lastName}`,
        }))}
        staffId={staffId}
        onStaffChange={setStaffId}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        onFilters={noop}
        rows={ROWS}
        selectedIds={selectedIds}
        onToggleRow={toggleRow}
        onToggleAll={() =>
          setSelectedIds((prev) =>
            prev.length === ROWS.length ? [] : ROWS.map((r) => r.id),
          )
        }
        onOpenRow={noop}
        onRowMenu={noop}
        showCost
        showDoubleTime
        emptyMessage="No timesheets in this period."
        page={page}
        pageCount={4}
        rangeFrom={1}
        rangeTo={8}
        total={32}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        counts={COUNTS}
        summaryRangeLabel="This Week"
        onSummaryRangeClick={noop}
        pending={PENDING}
        pendingMoreCount={5}
        onViewAllPending={noop}
        rules={RULES}
        onEditRules={noop}
        quickActions={QUICK_ACTIONS}
        onViewGuide={noop}
      />
    </div>
  );
}
