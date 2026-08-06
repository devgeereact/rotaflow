/**
 * Maps Supabase rows onto the Staff Directory view models. Pure functions,
 * no network, no React, so `/app/staff` and the design-loop preview render
 * exactly the same component tree.
 *
 * `availability.weekday` is stored the way JavaScript reports it:
 * `0 = Sunday … 6 = Saturday` (`Date.prototype.getDay`).
 */

import { format } from 'date-fns';
import type {
  Availability,
  Department,
  LeaveRequest,
  Location,
  Shift,
  StaffDocument as DocumentRow,
  StaffProfile,
} from '@/types';
import type {
  AvailabilityDay,
  AvailabilityTone,
  DocumentStatus,
  StaffDetails,
  StaffDirectoryRow,
  StaffDirectoryStats,
  StaffDocument,
  StaffStatus,
} from '@/lib/staffDirectory';

/** Monday-first, matching the six dots the reference meter shows. */
const METER_WEEKDAYS = [1, 2, 3, 4, 5, 6];

/** "Senior Nurse" → "SN". The reference's RN/CA codes are org vocabulary we don't store. */
export function roleCodeFor(jobTitle: string | null): string | null {
  if (!jobTitle) return null;
  const words = jobTitle.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

function toneForWeekday(entries: Availability[], weekday: number): AvailabilityTone {
  const forDay = entries.filter((entry) => entry.weekday === weekday);
  if (forDay.length === 0) return 'none';
  if (forDay.some((entry) => entry.status === 'unavailable')) return 'unavailable';
  if (forDay.some((entry) => entry.status === 'preferred')) return 'available';
  return forDay.some((entry) => entry.status === 'available') ? 'available' : 'partial';
}

function availabilityMeter(entries: Availability[]): {
  tones: AvailabilityTone[];
  percent: number;
} {
  const tones = METER_WEEKDAYS.map((weekday) => toneForWeekday(entries, weekday));
  const available = tones.filter((tone) => tone === 'available').length;
  return { tones, percent: Math.round((available / METER_WEEKDAYS.length) * 100) };
}

export function documentStatusFor(expiresAt: string | null, now: Date): DocumentStatus {
  if (!expiresAt) return 'valid';
  const expiry = new Date(expiresAt);
  if (expiry.getTime() <= now.getTime()) return 'expired';
  const daysLeft = (expiry.getTime() - now.getTime()) / 86_400_000;
  return daysLeft <= 60 ? 'expiring' : 'valid';
}

export function toStaffDocument(row: DocumentRow, now: Date): StaffDocument {
  return {
    id: row.id,
    name: row.name,
    expiresLabel: row.expires_at
      ? `Expires ${format(new Date(row.expires_at), 'd MMM yyyy')}`
      : 'No expiry',
    status: documentStatusFor(row.expires_at, now),
  };
}

interface DirectoryContext {
  departments: Department[];
  locations: Location[];
  availability: Availability[];
  /** Approved leave overlapping today, used to flag the On Leave status. */
  onLeaveIds: Set<string>;
}

function locationNameFor(
  profile: StaffProfile,
  { departments, locations }: Pick<DirectoryContext, 'departments' | 'locations'>,
): string {
  const department = departments.find((d) => d.id === profile.department_id);
  const location = locations.find((l) => l.id === department?.location_id);
  return location?.name ?? '-';
}

export function statusFor(profile: StaffProfile, onLeave: boolean): StaffStatus {
  if (!profile.active) return 'inactive';
  return onLeave ? 'on_leave' : 'active';
}

export function toDirectoryRow(
  profile: StaffProfile,
  context: DirectoryContext,
): StaffDirectoryRow {
  const entries = context.availability.filter((a) => a.staff_profile_id === profile.id);
  const meter = availabilityMeter(entries);

  return {
    id: profile.id,
    firstName: profile.first_name,
    lastName: profile.last_name,
    photoUrl: profile.photo_url,
    payrollId: profile.payroll_id ?? '-',
    role: profile.job_title ?? '-',
    roleCode: roleCodeFor(profile.job_title),
    roleCodeTone: 'neutral',
    department:
      context.departments.find((d) => d.id === profile.department_id)?.name ?? '-',
    location: locationNameFor(profile, context),
    skills: profile.skills ?? [],
    availability: meter.tones,
    availabilityPercent: meter.percent,
    status: statusFor(profile, context.onLeaveIds.has(profile.id)),
  };
}

/** Approved leave rows covering `today`, as a set of staff-profile ids. */
export function onLeaveToday(leave: LeaveRequest[], today: string): Set<string> {
  return new Set(
    leave
      .filter(
        (request) =>
          request.status === 'approved' &&
          request.start_date <= today &&
          request.end_date >= today,
      )
      .map((request) => request.staff_profile_id),
  );
}

export function buildStats(
  staff: StaffProfile[],
  shiftsToday: Shift[],
  onLeave: Set<string>,
  availability: Availability[],
  today: Date,
): StaffDirectoryStats {
  const active = staff.filter((person) => person.active);
  const assigned = new Set(
    shiftsToday
      .map((shift) => shift.staff_profile_id)
      .filter((id): id is string => Boolean(id)),
  );
  const weekday = today.getDay();
  const unavailable = new Set(
    availability
      .filter((entry) => entry.weekday === weekday && entry.status === 'unavailable')
      .map((entry) => entry.staff_profile_id),
  );

  return {
    totalStaff: active.length,
    onShiftToday: active.filter((person) => assigned.has(person.id)).length,
    onLeaveToday: active.filter((person) => onLeave.has(person.id)).length,
    unavailableToday: active.filter((person) => unavailable.has(person.id)).length,
    vacancies: shiftsToday.filter((shift) => !shift.staff_profile_id).length,
  };
}

/** The seven-day strip in the details panel, starting from `weekStart`. */
export function buildWeek(entries: Availability[], weekStart: Date): AvailabilityDay[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + offset);
    const forDay = entries.filter((entry) => entry.weekday === day.getDay());
    const working = forDay.find(
      (entry) => entry.status !== 'unavailable' && entry.start_time && entry.end_time,
    );

    return {
      weekday: format(day, 'EEE'),
      date: format(day, 'd MMM'),
      timeLabel: working
        ? `${working.start_time!.slice(0, 5)}, ${working.end_time!.slice(0, 5)}`
        : null,
      tone: working ? 'default' : 'off',
    };
  });
}

export function toStaffDetails(
  profile: StaffProfile,
  context: DirectoryContext,
  documents: DocumentRow[],
  email: string,
  weekStart: Date,
  now: Date,
): StaffDetails {
  const entries = context.availability.filter((a) => a.staff_profile_id === profile.id);

  return {
    id: profile.id,
    firstName: profile.first_name,
    lastName: profile.last_name,
    photoUrl: profile.photo_url,
    role: profile.job_title ?? '-',
    location: locationNameFor(profile, context),
    email,
    phone: profile.phone ?? '-',
    joinedLabel: profile.start_date
      ? `Joined ${format(new Date(profile.start_date), 'd MMMM yyyy')}`
      : 'Start date not set',
    status: statusFor(profile, context.onLeaveIds.has(profile.id)),
    skills: profile.skills ?? [],
    week: buildWeek(entries, weekStart),
    documents: documents.map((row) => toStaffDocument(row, now)),
  };
}
