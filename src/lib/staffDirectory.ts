/**
 * View models for the Staff Directory and Staff Profile screens
 * (docs/design/staff.png, docs/design/Staff-Profile.png).
 *
 * These are presentation shapes, not database rows, a directory row folds in
 * a department name, a location name and a derived availability meter that no
 * single `staff_profiles` row carries. Services map Supabase rows into these;
 * see `src/lib/staffDemo.ts` for the design-loop fixtures.
 */

/** Employment state shown in the directory's Status column. */
export type StaffStatus = 'active' | 'on_leave' | 'unavailable' | 'inactive';

/**
 * One segment of the six-dot availability meter. The reference colours each
 * dot independently of the percentage beside it, so this is per-day state,
 * not a fill level.
 */
export type AvailabilityTone = 'available' | 'partial' | 'unavailable' | 'none';

/** Badge tint for a role's short code (`RN`, `CA`). */
export type RoleCodeTone = 'violet' | 'neutral';

export interface StaffDirectoryRow {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  /** Payroll / employee reference shown under the name. */
  payrollId: string;
  role: string;
  roleCode: string | null;
  roleCodeTone: RoleCodeTone;
  department: string;
  location: string;
  skills: string[];
  /** Six per-day tones, Monday-first, driving the availability meter. */
  availability: AvailabilityTone[];
  availabilityPercent: number;
  status: StaffStatus;
}

export interface StaffDirectoryStats {
  totalStaff: number;
  onShiftToday: number;
  onLeaveToday: number;
  unavailableToday: number;
  vacancies: number;
}

/** A day row in the "Availability This Week" list. */
export interface AvailabilityDay {
  weekday: string;
  date: string;
  /** `null` renders the "Unavailable" treatment instead of a time range. */
  timeLabel: string | null;
  /** `accent` is the reference's blue evening-shift row. */
  tone: 'default' | 'accent' | 'off';
}

export type DocumentStatus = 'valid' | 'expiring' | 'expired';

export interface StaffDocument {
  id: string;
  name: string;
  expiresLabel: string;
  status: DocumentStatus;
}

/** Right-hand summary panel on the directory screen. */
export interface StaffDetails {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  role: string;
  location: string;
  email: string;
  phone: string;
  joinedLabel: string;
  status: StaffStatus;
  skills: string[];
  week: AvailabilityDay[];
  documents: StaffDocument[];
}

export const STAFF_STATUS_LABELS: Record<StaffStatus, string> = {
  active: 'Active',
  on_leave: 'On Leave',
  unavailable: 'Unavailable',
  inactive: 'Inactive',
};
