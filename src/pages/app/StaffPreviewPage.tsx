import { useState } from 'react';
import { TeamDirectoryView } from '@/components/staff/TeamDirectoryView';
import type { TeamRow } from '@/lib/teamRows';
import type { Department, Location } from '@/types';

const DEPARTMENTS: Department[] = [
  {
    id: 'd1',
    org_id: 'org-1',
    location_id: 'loc1',
    name: 'Nursing',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'd2',
    org_id: 'org-1',
    location_id: 'loc2',
    name: 'Care',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
];

const LOCATIONS: Location[] = [
  {
    id: 'loc1',
    org_id: 'org-1',
    name: 'Sunnyvale House',
    address: null,
    timezone: 'Europe/London',
    latitude: null,
    longitude: null,
    geofence_radius_m: 150,
    location_type: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'loc2',
    org_id: 'org-1',
    name: 'Riverside House',
    address: null,
    timezone: 'Europe/London',
    latitude: null,
    longitude: null,
    geofence_radius_m: 150,
    location_type: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
];

const ROWS: TeamRow[] = [
  {
    id: 's1',
    firstName: 'Amara',
    lastName: 'Osei',
    photoUrl: null,
    jobTitle: 'Senior Carer',
    department: 'Nursing',
    location: 'Sunnyvale House',
    locationIds: [],
    contractHoursLabel: '37.5h',
    rosteredHoursLabel: '36.0h',
    todayStatus: 'on_shift',
    active: true,
  },
  {
    id: 's2',
    firstName: 'Callum',
    lastName: 'Reid',
    photoUrl: null,
    jobTitle: 'Care Assistant',
    department: 'Care',
    location: 'Riverside House',
    locationIds: [],
    contractHoursLabel: '30.0h',
    rosteredHoursLabel: '30.0h',
    todayStatus: 'off',
    active: true,
  },
  {
    id: 's3',
    firstName: 'Priya',
    lastName: 'Raman',
    photoUrl: null,
    jobTitle: 'Senior Nurse',
    department: 'Nursing',
    location: 'Sunnyvale House',
    locationIds: [],
    contractHoursLabel: '37.5h',
    rosteredHoursLabel: '0.0h',
    todayStatus: 'absent',
    active: true,
  },
];

/**
 * Design-loop preview only, mounted inside `AppShellPreviewPage`
 * (`/admin-preview`-style harness). The real `/app/team` needs a live
 * Supabase session and a seeded organisation, neither of which a screenshot
 * tool has. Renders the real `TeamDirectoryView` against fixed mock data
 * shaped to match `docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.team`.
 */
export function StaffPreviewPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [locationId, setLocationId] = useState('');

  const filtered = ROWS.filter((r) => {
    if (
      search.trim() &&
      !`${r.firstName} ${r.lastName}`.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="p-8">
      <TeamDirectoryView
        orgName="Sunnyvale Care Group"
        tiles={{
          teamMembers: 12,
          onShiftToday: 7,
          absentToday: 1,
          onLeaveToday: 2,
          documentsExpiring: 3,
          invitesOutstanding: 2,
        }}
        search={search}
        onSearchChange={setSearch}
        departmentId={departmentId}
        onDepartmentChange={setDepartmentId}
        locationId={locationId}
        onLocationChange={setLocationId}
        departments={DEPARTMENTS}
        locations={LOCATIONS}
        rows={filtered}
        totalRowCount={ROWS.length}
        emptyMessage="Nobody matches these filters."
        onOpenActions={() => {}}
        onExport={() => {}}
        onAddStaff={() => {}}
      />
    </div>
  );
}
