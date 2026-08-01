import { useState } from 'react';
import { BarChart3, CalendarDays, Settings } from 'lucide-react';
import { LeaveView } from '@/components/leave/LeaveView';
import type { LeaveFilterSelect } from '@/components/leave/LeaveFilterBar';
import type { LeaveSort } from '@/components/leave/LeaveTable';
import type { LeaveTab } from '@/components/leave/LeaveTabs';
import {
  DEMO_LEAVE_APPROVALS,
  DEMO_LEAVE_BALANCES,
  DEMO_LEAVE_COUNTS,
  DEMO_LEAVE_PAGE_SIZE,
  DEMO_LEAVE_ROWS,
  DEMO_LEAVE_TOTAL,
} from '@/lib/leaveDemo';

/**
 * Design-loop preview only — `/app/leave` needs a real Supabase session and a
 * seeded organisation. This renders the same components against the fixtures
 * in `src/lib/leaveDemo.ts`, reproducing design/Leave.png. Not wired to any
 * service call; see design/.loop/leave-log.md.
 *
 * The padding matches `AppShell`'s `<main>` so the content column lines up
 * with the reference; the sidebar and header the reference shows are chrome
 * the preview deliberately omits (docs/LOOP.md).
 */
export function LeavePreviewPage(): JSX.Element {
  const [tab, setTab] = useState<LeaveTab>('all');
  const [location, setLocation] = useState('');
  const [department, setDepartment] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<LeaveSort | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEMO_LEAVE_PAGE_SIZE);

  const selects: LeaveFilterSelect[] = [
    {
      id: 'locations',
      allLabel: 'All Locations',
      ariaLabel: 'Filter by location',
      value: location,
      onChange: setLocation,
      options: [
        { id: 'sunshine', name: 'Sunshine Care Home' },
        { id: 'riverside', name: 'Riverside House' },
        { id: 'oakview', name: 'Oakview Care Home' },
      ],
    },
    {
      id: 'departments',
      allLabel: 'All Departments',
      ariaLabel: 'Filter by department',
      value: department,
      onChange: setDepartment,
      options: [
        { id: 'nursing', name: 'Nursing' },
        { id: 'care', name: 'Care' },
      ],
    },
    {
      id: 'types',
      allLabel: 'All Leave Types',
      ariaLabel: 'Filter by leave type',
      value: type,
      onChange: setType,
      options: [
        { id: 'annual', name: 'Annual Leave' },
        { id: 'sick', name: 'Sick Leave' },
        { id: 'personal', name: 'Personal Leave' },
        { id: 'carer', name: "Carer's Leave" },
      ],
    },
    {
      id: 'statuses',
      allLabel: 'All Statuses',
      ariaLabel: 'Filter by status',
      value: status,
      onChange: setStatus,
      options: [
        { id: 'pending', name: 'Pending' },
        { id: 'approved', name: 'Approved' },
        { id: 'rejected', name: 'Declined' },
        { id: 'cancelled', name: 'Cancelled' },
      ],
    },
  ];

  const noop = (): void => {};

  return (
    <div className="min-h-screen bg-background px-6 py-8 md:px-10 dark:bg-background-dark">
      <LeaveView
        tabs={[
          { value: 'all', label: 'All Requests' },
          { value: 'pending', label: 'Pending Approval', count: 6 },
          { value: 'approved', label: 'Approved' },
          { value: 'declined', label: 'Declined' },
          { value: 'cancelled', label: 'Cancelled' },
        ]}
        activeTab={tab}
        onTabChange={setTab}
        onExport={noop}
        onRequestLeave={noop}
        periodLabel="26 May – 1 June 2025"
        onPeriodClick={noop}
        selects={selects}
        onFilters={noop}
        rows={DEMO_LEAVE_ROWS}
        sort={sort}
        onSortChange={setSort}
        onOpenRow={noop}
        onRowMenu={noop}
        emptyMessage="No leave requests match these filters."
        page={page}
        pageCount={Math.ceil(DEMO_LEAVE_TOTAL / pageSize)}
        rangeFrom={1}
        rangeTo={DEMO_LEAVE_ROWS.length}
        total={DEMO_LEAVE_TOTAL}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        counts={DEMO_LEAVE_COUNTS}
        overviewRangeLabel="This Year"
        onOverviewRangeClick={noop}
        balances={DEMO_LEAVE_BALANCES}
        onViewAllBalances={noop}
        approvalQueues={DEMO_LEAVE_APPROVALS}
        onViewAllApprovals={noop}
        onOpenQueue={noop}
        quickActions={[
          { id: 'calendar', icon: CalendarDays, label: 'Team Calendar' },
          { id: 'report', icon: BarChart3, label: 'Leave Report' },
          { id: 'settings', icon: Settings, label: 'Leave Settings' },
        ]}
        onViewTeamCalendar={noop}
      />
    </div>
  );
}
