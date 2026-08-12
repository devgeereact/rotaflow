import { OvertimeView } from '@/components/overtime/OvertimeView';
import type { OvertimeRow } from '@/lib/overtimeRows';

const ROWS: OvertimeRow[] = [
  {
    id: 'o1',
    staffProfileId: 'staff-1',
    staffName: 'Amara Osei',
    jobTitle: 'Senior Carer',
    photoUrl: null,
    dateLabel: 'Mon 4 Aug 2026',
    date: '2026-08-04',
    hours: 1.5,
    hoursLabel: '1h 30m',
    status: 'pending',
    statusNote: 'Needs approval',
    note: 'Handover ran late after an admission',
  },
  {
    id: 'o2',
    staffProfileId: 'staff-4',
    staffName: 'Tomas Nowak',
    jobTitle: 'Night Lead',
    photoUrl: null,
    dateLabel: 'Sun 3 Aug 2026',
    date: '2026-08-03',
    hours: 2,
    hoursLabel: '2h',
    status: 'approved',
    statusNote: 'Approved',
    note: 'Covered the second half of a night shift',
  },
  {
    id: 'o3',
    staffProfileId: 'staff-9',
    staffName: 'Grace Nkemdi',
    jobTitle: 'Activities Lead',
    photoUrl: null,
    dateLabel: 'Fri 1 Aug 2026',
    date: '2026-08-01',
    hours: 0.5,
    hoursLabel: '30m',
    status: 'approved',
    statusNote: 'Approved',
    note: 'Stayed for the medication audit',
  },
  {
    id: 'o4',
    staffProfileId: 'staff-2',
    staffName: 'Callum Reid',
    jobTitle: 'Care Assistant',
    photoUrl: null,
    dateLabel: 'Thu 31 Jul 2026',
    date: '2026-07-31',
    hours: 3,
    hoursLabel: '3h',
    status: 'rejected',
    statusNote: 'Declined',
    note: 'Agency no-show',
  },
];

/**
 * Design-loop preview only, mounted inside `AppShellPreviewPage`
 * (`/admin-preview`-style harness). The real `/app/overtime` needs a live
 * Supabase session and a seeded organisation, neither of which a screenshot
 * tool has. Renders the real `OvertimeView` against fixed mock data shaped
 * to match `docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.overtime`.
 * `?role=staff` switches branch.
 */
export function OvertimePreviewPage(): JSX.Element {
  const role = new URLSearchParams(window.location.search).get('role');
  const canApprove = role !== 'staff';

  return (
    <div className="p-8">
      <OvertimeView
        canApprove={canApprove}
        viewerStaffId="staff-1"
        tiles={
          canApprove
            ? {
                awaitingDecision: 1,
                awaitingDecisionHoursLabel: '1h 30m',
                secondLabel: 'Approved this month',
                secondValue: '14h 30m',
                requestsShown: ROWS.length,
              }
            : {
                awaitingDecision: 1,
                awaitingDecisionHoursLabel: '1h 30m',
                secondLabel: 'Approved',
                secondValue: '0h',
                requestsShown: 1,
              }
        }
        rows={canApprove ? ROWS : [ROWS[0]!]}
        emptyMessage="No overtime claims."
        onRaiseClaim={async () => {}}
        onApprove={async () => {}}
        onDecline={async () => {}}
        onWithdraw={async () => {}}
      />
    </div>
  );
}
