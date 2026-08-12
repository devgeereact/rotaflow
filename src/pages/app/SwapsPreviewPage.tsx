import { useState } from 'react';
import { BarChart3, CalendarDays } from 'lucide-react';
import { SwapsView } from '@/components/swaps/SwapsView';
import { countByStatus, toSwapTab } from '@/lib/swapRows';
import type { SwapRow, SwapTab } from '@/lib/swapRows';
import type { SwapTabDef } from '@/components/swaps/SwapTabs';

const ROWS: SwapRow[] = [
  {
    id: 's1',
    from: {
      firstName: 'Amara',
      lastName: 'Osei',
      jobTitle: 'Senior Carer',
      photoUrl: null,
    },
    fromStaffId: 'staff-1',
    to: null,
    toStaffId: null,
    shift: {
      dateLabel: 'Mon 4 Aug 2026',
      timeLabel: '07:00, 19:30',
      locationName: 'Sunnyvale House',
    },
    requestedLabel: 'Today, 09:15',
    note: 'Family commitment that morning.',
    status: 'open',
    statusNote: null,
    needsReview: true,
  },
  {
    id: 's2',
    from: {
      firstName: 'Callum',
      lastName: 'Reid',
      jobTitle: 'Care Assistant',
      photoUrl: null,
    },
    fromStaffId: 'staff-2',
    to: { firstName: 'Tomas', lastName: 'Nowak', jobTitle: 'Night Lead', photoUrl: null },
    toStaffId: 'staff-3',
    shift: {
      dateLabel: 'Fri 8 Aug 2026',
      timeLabel: '19:00, 07:30',
      locationName: 'Riverside House',
    },
    requestedLabel: 'Yesterday, 16:40',
    note: null,
    status: 'awaiting_colleague',
    statusNote: null,
    needsReview: false,
  },
  {
    id: 's3',
    from: {
      firstName: 'Priya',
      lastName: 'Raman',
      jobTitle: 'Care Assistant',
      photoUrl: null,
    },
    fromStaffId: 'staff-4',
    to: {
      firstName: 'Grace',
      lastName: 'Nkemdi',
      jobTitle: 'Activities Lead',
      photoUrl: null,
    },
    toStaffId: 'staff-5',
    shift: {
      dateLabel: 'Tue 5 Aug 2026',
      timeLabel: '07:00, 19:30',
      locationName: 'Sunnyvale House',
    },
    requestedLabel: '2 Aug 2026',
    note: 'Swapping to cover a hospital appointment.',
    status: 'accepted',
    statusNote: 'Ready for your approval',
    needsReview: true,
  },
  {
    id: 's4',
    from: {
      firstName: 'Sean',
      lastName: 'Callaghan',
      jobTitle: 'Care Assistant',
      photoUrl: null,
    },
    fromStaffId: 'staff-6',
    to: {
      firstName: 'Amara',
      lastName: 'Osei',
      jobTitle: 'Senior Carer',
      photoUrl: null,
    },
    toStaffId: 'staff-1',
    shift: {
      dateLabel: 'Wed 30 Jul 2026',
      timeLabel: '07:00, 15:00',
      locationName: 'Oakview Care Home',
    },
    requestedLabel: '28 Jul 2026',
    note: null,
    status: 'approved',
    statusNote: 'Approved',
    needsReview: false,
  },
  {
    id: 's5',
    from: {
      firstName: 'Idris',
      lastName: 'Okafor',
      jobTitle: 'Activities Lead',
      photoUrl: null,
    },
    fromStaffId: 'staff-7',
    to: {
      firstName: 'Ffion',
      lastName: 'Davies',
      jobTitle: 'Care Assistant',
      photoUrl: null,
    },
    toStaffId: 'staff-8',
    shift: {
      dateLabel: 'Thu 24 Jul 2026',
      timeLabel: '09:00, 17:00',
      locationName: 'Riverside House',
    },
    requestedLabel: '20 Jul 2026',
    note: null,
    status: 'declined',
    statusNote: null,
    needsReview: false,
  },
];

const QUICK_ACTIONS = [
  { id: 'calendar', icon: CalendarDays, label: 'Team Calendar', to: '/app/schedule' },
  { id: 'report', icon: BarChart3, label: 'Swap Report', to: '/app/reports' },
];

/**
 * Design-loop preview only, mounted inside `AppShellPreviewPage`
 * (`/admin-preview`-style harness). The real `/app/swaps` needs a live
 * Supabase session and a seeded organisation, neither of which a screenshot
 * tool has. Renders the real `SwapsView` against fixed mock data shaped to
 * match `design/Swap-Request.png`. `?role=staff` switches branch — the
 * view itself is one component; only `canApprove` and `viewerStaffId` change.
 */
export function SwapsPreviewPage(): JSX.Element {
  const role = new URLSearchParams(window.location.search).get('role');
  const canApprove = role !== 'staff';
  const viewerStaffId = canApprove ? 'staff-mgr' : 'staff-4';

  const [activeTab, setActiveTab] = useState<SwapTab>('pending');
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  const rows =
    activeTab === 'all' ? ROWS : ROWS.filter((r) => toSwapTab(r.status) === activeTab);
  const counts = countByStatus(ROWS);
  const openRow = ROWS.find((r) => r.id === openRowId) ?? null;

  const tabs: SwapTabDef[] = [
    {
      value: 'all',
      label: 'All Requests',
      count: ROWS.length,
      tone: 'primary',
      emphasis: 'soft',
    },
    {
      value: 'pending',
      label: 'Pending Approval',
      count: ROWS.filter((r) => toSwapTab(r.status) === 'pending').length,
      tone: 'warning',
      emphasis: 'solid',
    },
    {
      value: 'approved',
      label: 'Approved',
      count: ROWS.filter((r) => toSwapTab(r.status) === 'approved').length,
      tone: 'success',
      emphasis: 'soft',
    },
    {
      value: 'declined',
      label: 'Declined',
      count: ROWS.filter((r) => toSwapTab(r.status) === 'declined').length,
      tone: 'danger',
      emphasis: 'soft',
    },
    {
      value: 'cancelled',
      label: 'Cancelled',
      count: ROWS.filter((r) => toSwapTab(r.status) === 'cancelled').length,
      tone: 'neutral',
      emphasis: 'soft',
    },
  ];

  return (
    <div className="p-8">
      <SwapsView
        title="Swaps"
        subtitle="Manage shift swap requests between team members."
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onExport={() => {}}
        canRequest
        periodLabel="This Week"
        onPeriodClick={() => {}}
        selects={[]}
        onMoreFilters={() => {}}
        rows={rows}
        onOpenRow={(row) => setOpenRowId(row.id)}
        onRowMenu={(row) => setOpenRowId(row.id)}
        onSortByRequested={() => {}}
        emptyMessage="No swap requests match these filters yet."
        page={1}
        pageCount={1}
        rangeFrom={rows.length === 0 ? 0 : 1}
        rangeTo={rows.length}
        total={rows.length}
        pageSize={10}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        counts={counts}
        overviewRangeLabel="This Week"
        onOverviewRangeClick={() => {}}
        activity={[
          {
            id: 'a1',
            kind: 'approved',
            title: "Sean Callaghan's swap was approved",
            detail: 'With Amara Osei',
            timeLabel: '28 Jul, 10:15',
          },
          {
            id: 'a2',
            kind: 'declined',
            title: "Idris Okafor's swap was declined",
            detail: 'With Ffion Davies',
            timeLabel: '20 Jul, 15:20',
          },
        ]}
        onViewAllActivity={() => setActiveTab('all')}
        quickActions={QUICK_ACTIONS}
        onViewPolicy={() => {}}
        myShifts={[]}
        colleagues={[]}
        onOfferShift={async () => {}}
        offline={false}
        canApprove={canApprove}
        viewerStaffId={viewerStaffId}
        openRow={openRow}
        onCloseDetail={() => setOpenRowId(null)}
        onManagerDecision={async () => {}}
        onColleagueDecision={async () => {}}
        onRequesterFinalize={async () => {}}
        onWithdraw={async () => {}}
      />
    </div>
  );
}
