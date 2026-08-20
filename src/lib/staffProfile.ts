/**
 * View models for the Staff Profile detail screen (design/Staff-Profile.png).
 * Kept apart from `staffDirectory.ts` so the directory bundle doesn't carry
 * shapes only the profile route uses.
 */

import type { LeaveStatus, LeaveTypeKey } from '@/lib/leaveRows';
import type { RoleCodeTone, StaffDocument } from '@/lib/staffDirectory';

/**
 * Tab strip under the profile header (`design/Staff-Profile.png`). Every tab
 * renders real content — `availability`/`swaps`/`skills`/`timesheets`/`notes`
 * were dropped: a person's availability and swaps already have their own
 * screens, so keeping cosmetic-only tabs for them would be worse than not
 * having them. Emergency contacts lives on Overview, not its own tab —
 * something a manager reaches for in an actual emergency shouldn't be a
 * click away behind a tab nobody thinks to open.
 */
export type StaffProfileTab = 'overview' | 'shifts' | 'documents' | 'leave' | 'activity';

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

export interface ProfileEmergencyContact {
  id: string;
  name: string;
  relationship: string;
  phone: string;
}

export interface ProfileLeaveRow {
  id: string;
  type: LeaveTypeKey;
  /** Pre-formatted, e.g. "30 May-1 June 2025". */
  dateLabel: string;
  days: number;
  status: LeaveStatus;
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
  documents: StaffDocument[];
  emergencyContacts: ProfileEmergencyContact[];
  leave: ProfileLeaveRow[];
}
