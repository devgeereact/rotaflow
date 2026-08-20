import { useState } from 'react';
import { LocationsView } from '@/components/locations/LocationsView';
import type { LocationRow } from '@/lib/locationsDirectory';

const ROWS: LocationRow[] = [
  {
    id: 'sunnyvale',
    name: 'Sunnyvale House',
    address: '12 Sunnyvale Road, Bristol',
    type: 'Residential',
    status: 'active',
    staff: 18,
    departmentIds: ['nursing', 'wellbeing'],
    departmentNames: ['Nursing', 'Wellbeing'],
    minimumCoverSummary: '3-6 people, varies by day',
  },
  {
    id: 'riverside',
    name: 'Riverside House',
    address: '4 Riverside Walk, Bristol',
    type: 'Dementia care',
    status: 'active',
    staff: 14,
    departmentIds: ['nursing', 'activities'],
    departmentNames: ['Nursing', 'Activities'],
    minimumCoverSummary: '4 people every day',
  },
  {
    id: 'oakview',
    name: 'Oakview Care Home',
    address: '',
    type: 'Residential',
    status: 'setup',
    staff: 0,
    departmentIds: [],
    departmentNames: [],
    minimumCoverSummary: null,
  },
];

/**
 * Design-loop preview only. `/app/locations` needs a real Supabase session
 * and a seeded organisation, neither of which a screenshot tool has.
 * Renders the real `LocationsView` against fixed mock data shaped to match
 * `docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.locations`.
 */
export function LocationsPreviewPage(): JSX.Element {
  const [rows] = useState(ROWS);

  return (
    <div className="min-h-screen bg-background px-5 py-6 dark:bg-background-dark">
      <LocationsView
        rows={rows}
        loading={false}
        canManage
        onAddLocation={() => {}}
        onEditLocation={() => {}}
        onOpenDepartments={() => {}}
        onOpenMinimumCover={() => {}}
      />
    </div>
  );
}
