import { AvailabilityView } from '@/components/availability/AvailabilityView';
import type { ExceptionRow, WeeklyPatternDay } from '@/lib/availabilityRows';

const WEEK_PATTERN: WeeklyPatternDay[] = [
  { weekday: 1, label: 'Mon', available: true, note: null, entryId: null },
  { weekday: 2, label: 'Tue', available: true, note: null, entryId: 'e-tue' },
  { weekday: 3, label: 'Wed', available: false, note: null, entryId: 'e-wed' },
  { weekday: 4, label: 'Thu', available: true, note: null, entryId: null },
  { weekday: 5, label: 'Fri', available: true, note: 'From 12:00', entryId: 'e-fri' },
  { weekday: 6, label: 'Sat', available: true, note: null, entryId: null },
  { weekday: 0, label: 'Sun', available: false, note: null, entryId: 'e-sun' },
];

const EXCEPTIONS: ExceptionRow[] = [
  {
    id: 'x1',
    date: '2026-08-16',
    dateLabel: '16 Aug 2026',
    availabilityLabel: 'Unavailable all day',
  },
  {
    id: 'x2',
    date: '2026-08-29',
    dateLabel: '29 Aug 2026',
    availabilityLabel: 'Available from 12:00',
  },
];

const TEAM_ROWS = [
  {
    staffId: 's1',
    firstName: 'Amara',
    lastName: 'Osei',
    photoUrl: null,
    available: true,
  },
  {
    staffId: 's2',
    firstName: 'Callum',
    lastName: 'Reid',
    photoUrl: null,
    available: true,
  },
  {
    staffId: 's3',
    firstName: 'Priya',
    lastName: 'Raman',
    photoUrl: null,
    available: false,
  },
  {
    staffId: 's4',
    firstName: 'Tomas',
    lastName: 'Nowak',
    photoUrl: null,
    available: true,
  },
  {
    staffId: 's5',
    firstName: 'Grace',
    lastName: 'Nkemdi',
    photoUrl: null,
    available: true,
  },
  {
    staffId: 's6',
    firstName: 'Sean',
    lastName: 'Callaghan',
    photoUrl: null,
    available: true,
  },
];

/**
 * Design-loop preview only, mounted inside `AppShellPreviewPage`
 * (`/admin-preview`-style harness). The real `/app/availability` needs a
 * live Supabase session and a seeded organisation, neither of which a
 * screenshot tool has. Renders the real `AvailabilityView` against fixed
 * mock data shaped to match `docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.availability`. `?role=staff` drops the "Team availability" card,
 * same as the real page for anyone who isn't a manager.
 */
export function AvailabilityPreviewPage(): JSX.Element {
  const role = new URLSearchParams(window.location.search).get('role');
  const isManager = role !== 'staff';

  return (
    <div className="p-8">
      <AvailabilityView
        weekPattern={WEEK_PATTERN}
        onToggleDay={() => {}}
        togglingWeekday={null}
        exceptions={EXCEPTIONS}
        onAddException={async () => {}}
        removingExceptionId={null}
        onRemoveException={() => {}}
        team={isManager ? { todayLabel: 'Wednesday', rows: TEAM_ROWS } : null}
      />
    </div>
  );
}
