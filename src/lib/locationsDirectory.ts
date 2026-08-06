/**
 * View models for the Locations & Departments workspace
 * (design/Locations-Management.png, design/Location-department.png).
 *
 * These are presentation shapes, not database rows. `locations` carries only
 * `name`/`address`/`latitude`/`longitude`/`timezone`/`geofence_radius_m` and
 * `departments` only `name`/`location_id` (docs/SCHEMA.md §3), so type, region,
 * capacity, coverage and the activity feed are folded in or derived by the
 * caller. Services map Supabase rows into these; `src/lib/locationsDemo.ts`
 * holds the design-loop fixtures.
 */

/** Operating state shown in the table's Status column and the detail panel. */
export type SiteStatus = 'active' | 'maintenance' | 'inactive';

/**
 * Tint for a location/department type chip. Named by token, not by meaning,
 * "Care Home" is violet because the reference draws it violet, and an org can
 * define types this file has never heard of.
 */
export type SiteTone =
  'primary' | 'violet' | 'info' | 'success' | 'rose' | 'warning' | 'teal';

/** Icon slot for a department row and its overview panel. */
export type DepartmentIcon =
  | 'clinical'
  | 'care'
  | 'night'
  | 'therapy'
  | 'housekeeping'
  | 'catering'
  | 'maintenance'
  | 'admin';

/** One tile in the summary row above either table. */
export type SiteStatIcon = 'pin' | 'check' | 'staff' | 'calendar' | 'coverage';

export interface SiteStat {
  id: string;
  label: string;
  value: string;
  hint: string;
  icon: SiteStatIcon;
  tone: SiteTone;
}

export interface LocationRow {
  id: string;
  name: string;
  address: string;
  /** Site photograph. `null` renders the building-icon fallback. */
  photoUrl: string | null;
  /** `null` where the org has not classified the site. There is no column for it. */
  type: string | null;
  typeTone: SiteTone;
  region: string | null;
  staff: number;
  upcomingShifts: number;
  coveragePercent: number;
  status: SiteStatus;
}

export interface DepartmentRow {
  id: string;
  name: string;
  description: string | null;
  icon: DepartmentIcon;
  iconTone: SiteTone;
  /** "All Locations" when the department spans every site. */
  location: string;
  type: string | null;
  typeTone: SiteTone;
  staff: number;
  upcomingShifts: number;
  coveragePercent: number;
  status: SiteStatus;
}

/** One box in the 2×3 grid inside either detail panel. */
export interface SiteMetric {
  id: string;
  label: string;
  value: string;
  /** Omitted on the boxes the reference leaves as label + value only. */
  hint?: string;
  /** `link` renders the blue "View staff →" affordance instead of a caption. */
  hintTone?: 'muted' | 'link';
}

export type SiteActivityKind =
  'complete' | 'staff' | 'maintenance' | 'settings' | 'qualification';

export interface SiteActivityEntry {
  id: string;
  kind: SiteActivityKind;
  title: string;
  detail: string;
  timeLabel: string;
}

/** One row in the detail panel's "Key Information" list. */
export interface SiteInfoRow {
  id: string;
  label: string;
  value: string;
  /** Renders an avatar before the value. The reference's Manager row. */
  avatarName?: string;
  avatarUrl?: string | null;
}

/** Sections of the location detail panel; only Overview is built. */
export type LocationPanelTab = 'overview' | 'staff' | 'shifts' | 'settings' | 'history';

export interface LocationDetails {
  id: string;
  name: string;
  status: SiteStatus;
  photoUrl: string | null;
  addressLines: string[];
  phone: string;
  email: string;
  metrics: SiteMetric[];
  info: SiteInfoRow[];
  /** Empty hides the section: `audit_logs` carries no location events yet. */
  activity: SiteActivityEntry[];
}

export interface DepartmentDetails {
  id: string;
  name: string;
  status: SiteStatus;
  icon: DepartmentIcon;
  iconTone: SiteTone;
  type: string | null;
  typeTone: SiteTone;
  description: string | null;
  metrics: SiteMetric[];
  /** Empty hides the section: `audit_logs` carries no location events yet. */
  activity: SiteActivityEntry[];
}

export const SITE_STATUS_LABELS: Record<SiteStatus, string> = {
  active: 'Active',
  maintenance: 'Maintenance',
  inactive: 'Inactive',
};

/**
 * Coverage bar colour. Thresholds read off the references: 90%+ draws green,
 * the 85-89% rows draw amber and the 78% row draws red.
 */
export function coverageTone(percent: number): 'success' | 'warning' | 'danger' {
  if (percent >= 90) return 'success';
  if (percent >= 80) return 'warning';
  return 'danger';
}
