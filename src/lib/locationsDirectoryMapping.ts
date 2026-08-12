/**
 * Maps Supabase rows onto the `/app/locations` view model
 * (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.locations`). Pure
 * functions, no network, no React, so the real page and the design-loop
 * preview render exactly the same component tree.
 */

import type { Department, Location, MinimumCoverRule, StaffProfile } from '@/types';
import type { LocationRow, SiteStatus } from '@/lib/locationsDirectory';

/** Department ids belonging to a site, used to attribute staff to that site. */
function departmentsAt(departments: Department[], locationId: string): Department[] {
  return departments.filter((d) => d.location_id === locationId);
}

function summariseCover(rules: MinimumCoverRule[]): string | null {
  if (rules.length === 0) return null;
  const values = rules.map((r) => r.min_staff);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return `${min} ${min === 1 ? 'person' : 'people'} every day`;
  return `${min}-${max} people, varies by day`;
}

export function toLocationRow(
  location: Location,
  departments: Department[],
  staff: StaffProfile[],
  coverRules: MinimumCoverRule[],
): LocationRow {
  const siteDepartments = departmentsAt(departments, location.id);
  const deptIds = new Set(siteDepartments.map((d) => d.id));

  return {
    id: location.id,
    name: location.name,
    address: location.address ?? '',
    type: location.location_type,
    status: (location.status as SiteStatus | undefined) ?? 'setup',
    staff: staff.filter((s) => s.department_id && deptIds.has(s.department_id)).length,
    departmentIds: siteDepartments.map((d) => d.id),
    departmentNames: siteDepartments.map((d) => d.name),
    minimumCoverSummary: summariseCover(
      coverRules.filter((r) => r.location_id === location.id),
    ),
  };
}

export interface LocationTileCounts {
  locations: number;
  departments: number;
  staffAssigned: number;
  inSetup: number;
}

export function buildLocationTiles(rows: LocationRow[]): LocationTileCounts {
  return {
    locations: rows.length,
    departments: new Set(rows.flatMap((r) => r.departmentIds)).size,
    staffAssigned: rows.reduce((sum, row) => sum + row.staff, 0),
    inSetup: rows.filter((row) => row.status === 'setup').length,
  };
}
