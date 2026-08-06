/**
 * View models for the Staff Profile detail screen (design/Staff-Profile.png).
 * Kept apart from `staffDirectory.ts` so the directory bundle doesn't carry
 * shapes only the profile route uses.
 */

import type { RoleCodeTone, StaffDocument } from '@/lib/staffDirectory';

/** Tab strip under the profile header. `overview` is the only built pane. */
export type StaffProfileTab =
  | 'overview'
  | 'availability'
  | 'shifts'
  | 'leave'
  | 'swaps'
  | 'skills'
  | 'timesheets'
  | 'notes'
  | 'files'
  | 'activity';

export interface StaffPersonalInfo {
  email: string;
  phone: string;
  joinedLabel: string;
  birthLabel: string;
  gender: string;
  location: string;
}

export interface StaffWorkInfoRow {
  label: string;
  value: string;
  /** Renders the value with a trailing role-code badge, e.g. `Senior Nurse RN`. */
  badge?: { code: string; tone: RoleCodeTone };
}

/** A row in "Upcoming Shifts". */
export interface UpcomingShift {
  id: string;
  dateLabel: string;
  timeLabel: string;
  typeName: string;
  /** Chip tint key. Matches the rota shift-type tints. */
  typeTone: 'morning' | 'evening' | 'night';
  locationName: string;
  areaName: string;
  confirmed: boolean;
}

/** One column of the Shift Summary bar row. */
export interface ShiftSummaryColumn {
  label: string;
  value: string;
  /** Bar tint key; `null` renders the hint text column instead of a bar. */
  tone: 'total' | 'morning' | 'evening' | 'night' | null;
}

export type ActivityKind = 'shift' | 'swap' | 'leave' | 'document';

export interface StaffActivityEntry {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  timeLabel: string;
}

export type SkillLevel = 'Advanced' | 'Intermediate' | 'Beginner';

export interface StaffSkill {
  name: string;
  /** `null` when the org has recorded the skill but not a competency level. */
  level: SkillLevel | null;
}

export type QualificationStatus = 'Active' | 'Completed' | 'Expiring';

export interface StaffQualification {
  id: string;
  name: string;
  issuer: string;
  /** A pill on the right, or a plain "Valid until …" caption when `null`. */
  status: QualificationStatus | null;
  validLabel?: string;
  /** Award-style qualifications use the badge icon; documents use the file icon. */
  icon: 'award' | 'file';
}

export interface StaffProfileMetric {
  label: string;
  value: string;
  suffix?: string;
  hint: string;
}

export interface StaffProfileData {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  role: string;
  department: string;
  location: string;
  active: boolean;
  personal: StaffPersonalInfo;
  work: StaffWorkInfoRow[];
  metrics: StaffProfileMetric[];
  upcoming: UpcomingShift[];
  summaryMonth: string;
  summary: ShiftSummaryColumn[];
  summaryHint: string;
  activity: StaffActivityEntry[];
  skills: StaffSkill[];
  qualifications: StaffQualification[];
  moreQualifications: number;
  documents: StaffDocument[];
}
