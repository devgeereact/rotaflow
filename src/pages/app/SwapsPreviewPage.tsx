import { SwapsView } from '@/components/swaps/SwapsView';
import type { SwapRow } from '@/lib/swapRows';

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
    status: 'awaiting_manager',
    statusNote: null,
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
  },
];

/**
 * Design-loop preview only, mounted inside `AppShellPreviewPage`
 * (`/admin-preview`-style harness). The real `/app/swaps` needs a live
 * Supabase session and a seeded organisation, neither of which a screenshot
 * tool has. Renders the real `SwapsView` against fixed mock data shaped to
 * match `docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.swaps`. `?role=staff`
 * switches branch (the view itself is one component; only `canApprove` and
 * `viewerStaffId` change).
 */
export function SwapsPreviewPage(): JSX.Element {
  const role = new URLSearchParams(window.location.search).get('role');
  const canApprove = role !== 'staff';

  return (
    <div className="p-8">
      <SwapsView
        canApprove={canApprove}
        viewerStaffId="staff-2"
        tiles={{
          openOnBoard: 1,
          waitingOnYou: canApprove ? 2 : 1,
          approvedThisMonth: 9,
          declined: 2,
        }}
        rows={ROWS}
        emptyMessage="No swap requests."
        myShifts={[]}
        colleagues={[]}
        onOfferShift={async () => {}}
        offline={false}
        onManagerDecision={async () => {}}
        onColleagueDecision={async () => {}}
        onWithdraw={async () => {}}
      />
    </div>
  );
}
