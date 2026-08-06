/**
 * Maps Supabase rows onto the Locations & Departments view models. Pure
 * functions, no network, no React, so `/app/locations` and the design-loop
 * preview render exactly the same component tree.
 *
 * **What the schema can and cannot back.** `locations` carries only `name`,
 * `address`, `latitude`, `longitude`, `timezone` and `geofence_radius_m`;
 * `departments` only `name` and `location_id` (docs/SCHEMA.md §3). The
 * references also show a site type, a region, an operating status, a capacity,
 * open hours, a manager, a payroll code, a cost centre and an activity feed,
 * none of which exist as columns. Rather than invent them, every such field
 * maps to `null` and the components omit it. Everything below is derived from
 * rows that really exist.
 */

import type { Department, Location, Shift, StaffProfile } from '@/types';
import type {
  DepartmentDetails,
  DepartmentIcon,
  DepartmentRow,
  LocationDetails,
  LocationRow,
  SiteMetric,
  SiteStat,
  SiteTone,
} from '@/lib/locationsDirectory';

/** Org-wide coverage target. No column for it; the references show 90%. */
export const COVERAGE_TARGET = 90;

/** Icon tints, cycled by index so a site's departments stay visually distinct. */
const ICON_CYCLE: { icon: DepartmentIcon; tone: SiteTone }[] = [
  { icon: 'clinical', tone: 'rose' },
  { icon: 'care', tone: 'primary' },
  { icon: 'night', tone: 'violet' },
  { icon: 'therapy', tone: 'teal' },
  { icon: 'housekeeping', tone: 'warning' },
  { icon: 'catering', tone: 'violet' },
  { icon: 'maintenance', tone: 'info' },
  { icon: 'admin', tone: 'success' },
];

function iconFor(index: number): { icon: DepartmentIcon; tone: SiteTone } {
  return ICON_CYCLE[index % ICON_CYCLE.length]!;
}

/**
 * Share of the period's shifts that have someone on them. An open shift is one
 * with no `staff_profile_id`. Exactly the gap a manager is looking for here.
 */
export function coverageOf(shifts: Shift[]): number {
  if (shifts.length === 0) return 0;
  const filled = shifts.filter((shift) => shift.staff_profile_id !== null).length;
  return Math.round((filled / shifts.length) * 100);
}

function openShiftsIn(shifts: Shift[]): number {
  return shifts.filter((shift) => shift.staff_profile_id === null).length;
}

/** Department ids belonging to a site, used to attribute staff to that site. */
function departmentIdsAt(departments: Department[], locationId: string): Set<string> {
  return new Set(
    departments.filter((d) => d.location_id === locationId).map((d) => d.id),
  );
}

export function toLocationRow(
  location: Location,
  departments: Department[],
  staff: StaffProfile[],
  shifts: Shift[],
): LocationRow {
  const deptIds = departmentIdsAt(departments, location.id);
  const siteShifts = shifts.filter((shift) => shift.location_id === location.id);

  return {
    id: location.id,
    name: location.name,
    address: location.address ?? '',
    photoUrl: null,
    type: null,
    typeTone: 'violet',
    region: null,
    staff: staff.filter((s) => s.department_id && deptIds.has(s.department_id)).length,
    upcomingShifts: siteShifts.length,
    coveragePercent: coverageOf(siteShifts),
    status: 'active',
  };
}

export function toDepartmentRow(
  department: Department,
  index: number,
  locations: Location[],
  staff: StaffProfile[],
  shifts: Shift[],
): DepartmentRow {
  const deptShifts = shifts.filter((shift) => shift.department_id === department.id);
  const site = locations.find((l) => l.id === department.location_id);
  const { icon, tone } = iconFor(index);

  return {
    id: department.id,
    name: department.name,
    description: null,
    icon,
    iconTone: tone,
    location: site?.name ?? 'All Locations',
    type: null,
    typeTone: 'rose',
    staff: staff.filter((s) => s.department_id === department.id).length,
    upcomingShifts: deptShifts.length,
    coveragePercent: coverageOf(deptShifts),
    status: 'active',
  };
}

function averageCoverage(rows: { coveragePercent: number }[]): number {
  if (rows.length === 0) return 0;
  return Math.round(
    rows.reduce((sum, row) => sum + row.coveragePercent, 0) / rows.length,
  );
}

export function buildLocationStats(rows: LocationRow[]): SiteStat[] {
  const shifts = rows.reduce((sum, row) => sum + row.upcomingShifts, 0);
  return [
    {
      id: 'total',
      label: 'Total Locations',
      value: String(rows.length),
      hint: 'Active sites',
      icon: 'pin',
      tone: 'primary',
    },
    {
      id: 'active',
      label: 'Active Locations',
      value: String(rows.filter((row) => row.status === 'active').length),
      hint: 'Online & operational',
      icon: 'check',
      tone: 'success',
    },
    {
      id: 'staff',
      label: 'Total Staff Assigned',
      value: String(rows.reduce((sum, row) => sum + row.staff, 0)),
      hint: 'Across all locations',
      icon: 'staff',
      tone: 'violet',
    },
    {
      id: 'shifts',
      label: 'Upcoming Shifts (7 days)',
      value: String(shifts),
      hint: 'Across all locations',
      icon: 'calendar',
      tone: 'warning',
    },
    {
      id: 'coverage',
      label: 'Avg. Coverage',
      value: `${averageCoverage(rows)}%`,
      hint: `Target: ${COVERAGE_TARGET}%`,
      icon: 'coverage',
      tone: 'success',
    },
  ];
}

export function buildDepartmentStats(rows: DepartmentRow[]): SiteStat[] {
  return [
    {
      id: 'total',
      label: 'Total Departments',
      value: String(rows.length),
      hint: 'Across all locations',
      icon: 'pin',
      tone: 'primary',
    },
    {
      id: 'staff',
      label: 'Total Staff',
      value: String(rows.reduce((sum, row) => sum + row.staff, 0)),
      hint: 'Assigned to departments',
      icon: 'staff',
      tone: 'success',
    },
    {
      id: 'shifts',
      label: 'Upcoming Shifts (7 days)',
      value: String(rows.reduce((sum, row) => sum + row.upcomingShifts, 0)),
      hint: 'In department schedules',
      icon: 'calendar',
      tone: 'warning',
    },
    {
      id: 'coverage',
      label: 'Avg. Coverage',
      value: `${averageCoverage(rows)}%`,
      hint: `Target: ${COVERAGE_TARGET}%`,
      icon: 'coverage',
      tone: 'violet',
    },
  ];
}

function coordinatesOf(location: Location): string {
  if (location.latitude === null || location.longitude === null) return 'Not set';
  return `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;
}

export function toLocationDetails(
  location: Location,
  row: LocationRow,
  departments: Department[],
  shifts: Shift[],
): LocationDetails {
  const siteShifts = shifts.filter((shift) => shift.location_id === location.id);
  const deptCount = departments.filter((d) => d.location_id === location.id).length;

  const metrics: SiteMetric[] = [
    {
      id: 'staff',
      label: 'Staff Assigned',
      value: String(row.staff),
      hint: 'View staff',
      hintTone: 'link',
    },
    {
      id: 'shifts',
      label: 'Upcoming Shifts',
      value: String(row.upcomingShifts),
      hint: 'Next 7 days',
    },
    {
      id: 'coverage',
      label: 'Coverage',
      value: `${row.coveragePercent}%`,
      hint: `Target: ${COVERAGE_TARGET}%`,
    },
    {
      id: 'departments',
      label: 'Departments',
      value: String(deptCount),
      hint: 'View all',
      hintTone: 'link',
    },
    {
      id: 'open',
      label: 'Open Shifts',
      value: String(openShiftsIn(siteShifts)),
      hint: 'Needs cover',
    },
    { id: 'timezone', label: 'Time Zone', value: location.timezone },
  ];

  return {
    id: location.id,
    name: location.name,
    status: row.status,
    photoUrl: null,
    addressLines: location.address ? location.address.split(', ') : ['No address set'],
    phone: '',
    email: '',
    metrics,
    info: [
      { id: 'coordinates', label: 'Coordinates', value: coordinatesOf(location) },
      {
        id: 'geofence',
        label: 'Clock-in radius',
        value: `${location.geofence_radius_m} m`,
      },
    ],
    activity: [],
  };
}

export function toDepartmentDetails(
  department: Department,
  row: DepartmentRow,
  shifts: Shift[],
): DepartmentDetails {
  const deptShifts = shifts.filter((shift) => shift.department_id === department.id);

  return {
    id: department.id,
    name: department.name,
    status: row.status,
    icon: row.icon,
    iconTone: row.iconTone,
    type: null,
    typeTone: row.typeTone,
    description: null,
    metrics: [
      {
        id: 'staff',
        label: 'Staff Assigned',
        value: String(row.staff),
        hint: 'View staff',
        hintTone: 'link',
      },
      {
        id: 'shifts',
        label: 'Upcoming Shifts',
        value: String(row.upcomingShifts),
        hint: 'Next 7 days',
      },
      {
        id: 'coverage',
        label: 'Coverage',
        value: `${row.coveragePercent}%`,
        hint: `Target: ${COVERAGE_TARGET}%`,
      },
      {
        id: 'open',
        label: 'Open Shifts',
        value: String(openShiftsIn(deptShifts)),
        hint: 'Needs cover',
      },
      { id: 'location', label: 'Location', value: row.location },
    ],
    activity: [],
  };
}
