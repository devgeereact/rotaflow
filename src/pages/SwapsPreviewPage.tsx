import { useState } from 'react';
import { SwapsView } from '@/components/swaps/SwapsView';
import {
  DEMO_SWAP_ACTIVITY,
  DEMO_SWAP_COUNTS,
  DEMO_SWAP_PERIOD,
  DEMO_SWAP_QUICK_ACTIONS,
  DEMO_SWAP_ROWS,
  DEMO_SWAP_RULES,
  DEMO_SWAP_TOTAL,
} from '@/lib/swapsDemo';
import type { SwapTabDef } from '@/components/swaps/SwapTabs';
import type { SwapFilterSelect } from '@/components/swaps/SwapFilterBar';
import type { SwapTab } from '@/lib/swapRows';

/**
 * Design-loop preview only, `/app/swaps` needs a real Supabase session, an org
 * and seeded swap rows. This renders the same components against the fixtures
 * in `src/lib/swapsDemo.ts`, reproducing design/Swap-Request.png. Not wired to
 * any service call; see design/.loop/swaps-log.md.
 */
export function SwapsPreviewPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<SwapTab>('all');
  const [location, setLocation] = useState('');
  const [department, setDepartment] = useState('');
  const [shiftType, setShiftType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const tabs: SwapTabDef[] = [
    { value: 'all', label: 'All Requests', count: 12, tone: 'primary', emphasis: 'soft' },
    {
      value: 'pending',
      label: 'Pending Approval',
      count: 5,
      tone: 'warning',
      emphasis: 'solid',
    },
    { value: 'approved', label: 'Approved', count: 4, tone: 'success', emphasis: 'soft' },
    { value: 'declined', label: 'Declined', count: 2, tone: 'danger', emphasis: 'soft' },
    {
      value: 'cancelled',
      label: 'Cancelled',
      count: 1,
      tone: 'neutral',
      emphasis: 'soft',
    },
  ];

  const selects: SwapFilterSelect[] = [
    {
      id: 'locations',
      allLabel: 'All Locations',
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
      value: department,
      onChange: setDepartment,
      options: [
        { id: 'nursing', name: 'Nursing' },
        { id: 'care', name: 'Care' },
      ],
    },
    {
      id: 'shift-types',
      allLabel: 'All Shift Types',
      value: shiftType,
      onChange: setShiftType,
      options: [
        { id: 'early', name: 'Early' },
        { id: 'late', name: 'Late' },
        { id: 'night', name: 'Night' },
      ],
    },
    {
      id: 'statuses',
      allLabel: 'All Statuses',
      value: status,
      onChange: setStatus,
      options: [
        { id: 'pending', name: 'Pending Approval' },
        { id: 'approved', name: 'Approved' },
        { id: 'declined', name: 'Declined' },
        { id: 'cancelled', name: 'Cancelled' },
      ],
    },
  ];

  const noop = (): void => {};

  return (
    <div className="min-h-screen bg-background px-5 py-6 dark:bg-background-dark">
      <SwapsView
        title="Swaps"
        subtitle="Manage shift swap requests between team members."
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onExport={noop}
        onNewRequest={noop}
        canRequest
        periodLabel={DEMO_SWAP_PERIOD}
        onPeriodClick={noop}
        selects={selects}
        onMoreFilters={noop}
        rows={DEMO_SWAP_ROWS}
        onOpenRow={noop}
        onRowMenu={noop}
        onSortByRequested={noop}
        emptyMessage="No swap requests match these filters."
        page={page}
        pageCount={2}
        rangeFrom={1}
        rangeTo={DEMO_SWAP_ROWS.length}
        total={DEMO_SWAP_TOTAL}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        counts={DEMO_SWAP_COUNTS}
        overviewRangeLabel="This Week"
        onOverviewRangeClick={noop}
        rules={DEMO_SWAP_RULES}
        onEditRules={noop}
        activity={DEMO_SWAP_ACTIVITY}
        onViewAllActivity={noop}
        quickActions={DEMO_SWAP_QUICK_ACTIONS}
        onViewPolicy={noop}
      />
    </div>
  );
}
