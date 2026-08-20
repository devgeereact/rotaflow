/**
 * Maps Supabase rows onto the Staff Profile view model.
 *
 * Only what the schema actually stores is produced. `docs/SCHEMA.md` has no
 * competency levels, qualifications register, shift ratings or per-person
 * activity feed, so those arrays come back empty and `StaffProfileView` drops
 * the cards rather than inventing values. See docs/design/.loop/staff-log.md.
 */

import { differenceInMinutes, format, isSameMonth } from 'date-fns';
import { roleCodeFor } from '@/lib/staffDirectoryMapping';
import { formatLeaveRange, leaveDayCount, leaveTypeKey } from '@/lib/leaveRows';
import type {
  Department,
  EmergencyContact,
  LeaveRequest,
  Location,
  Shift,
  StaffProfile,
} from '@/types';
import type { StaffDocument } from '@/lib/staffDirectory';
import type {
  ProfileEmergencyContact,
  ProfileLeaveRow,
  ShiftSummaryColumn,
  StaffProfileData,
  StaffProfileMetric,
  StaffWorkInfoRow,
  UpcomingShift,
} from '@/lib/staffProfile';

const CONTRACT_LABELS: Record<string, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  zero_hours: 'Zero-hours',
  casual: 'Casual',
};

export interface ProfileSources {
  staff: StaffProfile;
  departments: Department[];
  locations: Location[];
  /** Shifts from today forward, ordered by start. */
  upcoming: Shift[];
  /** Shifts already worked this month, used for the summary tiles. */
  thisMonth?: Shift[];
  documents: StaffDocument[];
  emergencyContacts: EmergencyContact[];
  /** This person's own leave requests, any status. */
  leave: LeaveRequest[];
  today: Date;
}

function toEmergencyContact(row: EmergencyContact): ProfileEmergencyContact {
  return {
    id: row.id,
    name: row.name,
    relationship: row.relationship ?? '-',
    phone: row.phone,
  };
}

function toLeaveRow(request: LeaveRequest): ProfileLeaveRow {
  return {
    id: request.id,
    type: leaveTypeKey(request.type),
    dateLabel: formatLeaveRange(request.start_date, request.end_date),
    days: leaveDayCount(request.start_date, request.end_date),
    status: request.status as ProfileLeaveRow['status'],
  };
}

function paidMinutes(shift: Shift): number {
  return Math.max(
    0,
    differenceInMinutes(new Date(shift.ends_at), new Date(shift.starts_at)) -
      (shift.break_minutes ?? 0),
  );
}

function toUpcoming(shift: Shift, today: Date, locationName: string): UpcomingShift {
  const starts = new Date(shift.starts_at);
  const ends = new Date(shift.ends_at);
  const hour = starts.getHours();

  return {
    id: shift.id,
    dateLabel:
      isSameMonth(starts, today) && starts.getDate() === today.getDate()
        ? `Today, ${format(starts, 'd MMM')}`
        : format(starts, 'EEE, d MMM'),
    timeLabel: `${format(starts, 'HH:mm')}, ${format(ends, 'HH:mm')}`,
    typeName: hour < 12 ? 'Morning Shift' : hour < 18 ? 'Evening Shift' : 'Night Shift',
    typeTone: hour < 12 ? 'morning' : hour < 18 ? 'evening' : 'night',
    locationName,
    areaName: shift.notes ?? '',
    confirmed: shift.status === 'confirmed',
  };
}

export function buildProfile({
  staff,
  departments,
  locations,
  upcoming,
  thisMonth = [],
  documents,
  emergencyContacts,
  leave,
  today,
}: ProfileSources): StaffProfileData {
  const department = departments.find((d) => d.id === staff.department_id);
  const location = locations.find((l) => l.id === department?.location_id);
  const locationName = location?.name ?? '-';

  const work: StaffWorkInfoRow[] = [];
  if (staff.payroll_id) work.push({ label: 'Employee ID', value: staff.payroll_id });
  if (staff.job_title) {
    const code = roleCodeFor(staff.job_title);
    work.push({
      label: 'Role',
      value: staff.job_title,
      ...(code ? { badge: { code, tone: 'neutral' as const } } : {}),
    });
  }
  if (department) work.push({ label: 'Department', value: department.name });
  if (location) work.push({ label: 'Location', value: location.name });
  if (staff.contract_type) {
    work.push({
      label: 'Employment Type',
      value: CONTRACT_LABELS[staff.contract_type] ?? staff.contract_type,
    });
  }
  if (staff.weekly_hours !== null) {
    work.push({ label: 'Contracted Hours', value: `${staff.weekly_hours} hours / week` });
  }
  if (staff.holiday_allowance !== null) {
    work.push({
      label: 'Holiday Allowance',
      value: `${staff.holiday_allowance} days`,
    });
  }

  const workedMinutes = thisMonth.reduce((total, shift) => total + paidMinutes(shift), 0);
  const workedHours = workedMinutes / 60;
  /** A contracted month is roughly 4.35 weeks; enough for a "% of contracted" hint. */
  const contractedHours = staff.weekly_hours ? staff.weekly_hours * 4.35 : null;
  const contractedPct = contractedHours
    ? `${Math.round((workedHours / contractedHours) * 100)}% of contracted`
    : 'No contracted hours set';

  const metrics: StaffProfileMetric[] = [];
  if (thisMonth.length > 0) {
    metrics.push(
      {
        label: 'Shifts This Month',
        value: String(thisMonth.length),
        hint: `${workedHours.toFixed(2)} hours`,
      },
      {
        label: 'Hours This Month',
        value: workedHours.toFixed(2),
        hint: contractedPct,
      },
    );
  }
  metrics.push({
    label: 'Upcoming Shifts',
    value: String(upcoming.length),
    hint: upcoming[0]
      ? `Next: ${format(new Date(upcoming[0].starts_at), 'd MMM HH:mm')}`
      : 'None scheduled',
  });
  if (staff.holiday_allowance !== null) {
    metrics.push({
      label: 'Leave Allowance',
      value: String(staff.holiday_allowance),
      hint: 'days per year',
    });
  }

  const summary: ShiftSummaryColumn[] =
    thisMonth.length > 0
      ? [
          { label: 'Total Shifts', value: String(thisMonth.length), tone: 'total' },
          { label: 'Hours Worked', value: workedHours.toFixed(2), tone: null },
        ]
      : [];

  return {
    id: staff.id,
    firstName: staff.first_name,
    lastName: staff.last_name,
    photoUrl: staff.photo_url,
    role: staff.job_title ?? '-',
    department: department?.name ?? '-',
    location: locationName,
    active: staff.active,
    personal: {
      email: '',
      phone: staff.phone ?? '',
      joinedLabel: staff.start_date
        ? `Joined ${format(new Date(staff.start_date), 'd MMMM yyyy')}`
        : '',
      birthLabel: '',
      gender: '',
      location: locationName,
    },
    work,
    metrics,
    upcoming: upcoming.slice(0, 4).map((shift) => toUpcoming(shift, today, locationName)),
    summaryMonth: format(today, 'MMMM yyyy'),
    summary,
    summaryHint: contractedPct,
    activity: [],
    skills: (staff.skills ?? []).map((name) => ({ name, level: null })),
    documents,
    emergencyContacts: emergencyContacts.map(toEmergencyContact),
    leave: leave.map(toLeaveRow),
  };
}
