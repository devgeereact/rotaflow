import { useState } from 'react';
import { ManagerLeave } from '@/components/leave/ManagerLeave';
import { StaffLeave } from '@/components/leave/StaffLeave';
import type { LeaveDisplayRow } from '@/components/leave/LeaveRowsTable';
import type { LeaveStatus } from '@/lib/leaveRows';

const ROWS: LeaveDisplayRow[] = [
  {
    id: 'l1',
    firstName: 'Amara',
    lastName: 'Osei',
    department: 'Nursing',
    photoUrl: null,
    type: 'annual',
    dateLabel: '25-29 August 2026',
    durationDays: 5,
    status: 'pending',
    statusNote: 'Needs approval',
    requestedLabel: 'Today, 09:15',
  },
  {
    id: 'l2',
    firstName: 'Callum',
    lastName: 'Reid',
    department: 'Care',
    photoUrl: null,
    type: 'sick',
    dateLabel: '5 August 2026',
    durationDays: 1,
    status: 'approved',
    statusNote: 'Approved',
    requestedLabel: 'Yesterday, 07:40',
  },
  {
    id: 'l3',
    firstName: 'Priya',
    lastName: 'Raman',
    department: 'Nursing',
    photoUrl: null,
    type: 'annual',
    dateLabel: '26-29 August 2026',
    durationDays: 4,
    status: 'pending',
    statusNote: 'Needs approval',
    requestedLabel: 'Yesterday, 16:30',
  },
  {
    id: 'l4',
    firstName: 'Tomas',
    lastName: 'Nowak',
    department: 'Care',
    photoUrl: null,
    type: 'personal',
    dateLabel: '12 July 2026',
    durationDays: 1,
    status: 'rejected',
    statusNote: 'Declined by you',
    requestedLabel: '10 July 2026',
  },
  {
    id: 'l5',
    firstName: 'Grace',
    lastName: 'Nkemdi',
    department: 'Activities',
    photoUrl: null,
    type: 'carer',
    dateLabel: '3-4 June 2026',
    durationDays: 2,
    status: 'cancelled',
    statusNote: 'Cancelled by staff',
    requestedLabel: '1 June 2026',
  },
];

/**
 * Design-loop preview only, mounted inside `AppShellPreviewPage`
 * (`/admin-preview`-style harness). The real `/app/leave` needs a live
 * Supabase session and a seeded organisation, neither of which a screenshot
 * tool has. Renders the real `ManagerLeave`/`StaffLeave` against fixed mock
 * data shaped to match `docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.leave`.
 * `?role=staff` switches branch.
 */
export function LeavePreviewPage(): JSX.Element {
  const role = new URLSearchParams(window.location.search).get('role');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | ''>('pending');

  const filtered = ROWS.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (
      search.trim() &&
      !`${r.firstName} ${r.lastName} ${r.type}`
        .toLowerCase()
        .includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="p-8">
      {role === 'staff' ? (
        <StaffLeave
          rows={filtered.filter((r) => r.firstName === 'Amara')}
          totalRowCount={1}
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          tiles={{
            entitlementLabel: '28 days',
            takenLabel: '17 days',
            remainingLabel: '11 days',
            remainingSubLabel: 'book before 31 Dec',
            pendingLabel: '6 days',
          }}
          onRequestLeave={async () => {}}
          offline={false}
          bankHolidayRegion="england-and-wales"
          onWithdraw={async () => {}}
        />
      ) : (
        <ManagerLeave
          rows={filtered}
          totalRowCount={ROWS.length}
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          tiles={{
            awaitingDecision: 2,
            oldestPendingLabel: 'oldest 16 days',
            approvedNext30Days: 7,
            sicknessDaysThisMonth: 4,
            coverRiskLabel: 'Aug 25-29',
            coverRiskSubLabel: '3 approved, 1 pending',
            teamEntitlementUsedLabel: '46%',
          }}
          onRequestLeave={async () => {}}
          offline={false}
          onApprove={async () => {}}
          bankHolidayRegion="england-and-wales"
          onDecline={async () => {}}
        />
      )}
    </div>
  );
}
