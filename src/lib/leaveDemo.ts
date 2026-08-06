/**
 * Design-loop fixtures for the Leave preview.
 *
 * `/app/leave` needs a real Supabase session and a seeded organisation, so
 * `/leave-preview` renders the same components against these fixed rows. The
 * numbers reproduce design/Leave.png exactly. Do not "improve" them. Nothing
 * here is used by the authenticated route.
 *
 * Three of the reference's values are not reproducible from real data and are
 * carried literally here; each is noted at the line and in
 * design/.loop/leave-log.md.
 */

import type {
  LeaveApprovalCount,
  LeaveBalance,
  LeaveRow,
  LeaveTypeCount,
} from '@/lib/leaveRows';

export const DEMO_LEAVE_ROWS: LeaveRow[] = [
  {
    id: 'emily-davis',
    firstName: 'Emily',
    lastName: 'Davis',
    jobTitle: 'Care Assistant',
    photoUrl: null,
    type: 'annual',
    dateLabel: '30 May-1 June 2025',
    dayLabel: 'Fri. Sun',
    durationLabel: '3 days',
    status: 'pending',
    statusNote: 'Needs approval',
    requestedLabel: 'Today, 09:15',
    requestedBy: 'Emily Davis',
  },
  {
    id: 'aisha-patel',
    firstName: 'Aisha',
    lastName: 'Patel',
    jobTitle: 'Senior Nurse',
    photoUrl: null,
    type: 'sick',
    dateLabel: '28 May 2025',
    dayLabel: 'Wed',
    durationLabel: '1 day',
    status: 'pending',
    statusNote: 'Needs approval',
    requestedLabel: 'Yesterday, 16:30',
    requestedBy: 'Aisha Patel',
  },
  {
    id: 'daniel-lee',
    firstName: 'Daniel',
    lastName: 'Lee',
    jobTitle: 'Care Assistant',
    photoUrl: null,
    type: 'personal',
    dateLabel: '27 May 2025',
    dayLabel: 'Tue',
    durationLabel: '1 day',
    status: 'approved',
    statusNote: 'Approved by you',
    requestedLabel: '25 May 2025',
    requestedBy: 'Daniel Lee',
  },
  {
    id: 'sarah-johnson',
    firstName: 'Sarah',
    lastName: 'Johnson',
    jobTitle: 'Senior Nurse',
    photoUrl: null,
    type: 'annual',
    dateLabel: '9-13 June 2025',
    dayLabel: 'Mon. Fri',
    durationLabel: '5 days',
    status: 'approved',
    statusNote: 'Approved by you',
    requestedLabel: '24 May 2025',
    requestedBy: 'Sarah Johnson',
  },
  {
    id: 'michael-brown',
    firstName: 'Michael',
    lastName: 'Brown',
    jobTitle: 'Care Assistant',
    photoUrl: null,
    type: 'carer',
    dateLabel: '22 May 2025',
    dayLabel: 'Thu',
    durationLabel: '1 day',
    status: 'rejected',
    statusNote: 'Insufficient cover',
    requestedLabel: '21 May 2025',
    requestedBy: 'Michael Brown',
  },
  {
    id: 'james-wilson',
    firstName: 'James',
    lastName: 'Wilson',
    jobTitle: 'Care Assistant',
    photoUrl: null,
    type: 'annual',
    dateLabel: '2-6 June 2025',
    dayLabel: 'Mon. Fri',
    durationLabel: '5 days',
    status: 'cancelled',
    statusNote: 'Cancelled by staff',
    requestedLabel: '20 May 2025',
    requestedBy: 'James Wilson',
  },
  {
    id: 'grace-thompson',
    firstName: 'Grace',
    lastName: 'Thompson',
    jobTitle: 'Senior Nurse',
    photoUrl: null,
    type: 'sick',
    dateLabel: '19 May 2025',
    dayLabel: 'Mon',
    durationLabel: '1 day',
    status: 'approved',
    statusNote: 'Approved by you',
    requestedLabel: '19 May 2025',
    requestedBy: 'Grace Thompson',
  },
  {
    id: 'liam-oconnor',
    firstName: 'Liam',
    lastName: "O'Connor",
    jobTitle: 'Care Assistant',
    photoUrl: null,
    type: 'personal',
    dateLabel: '16 May 2025',
    dayLabel: 'Fri',
    // The reference's only half day. `leave_requests` stores whole dates, so
    // the live page cannot produce this. It is a fixture-only string.
    durationLabel: '0.5 day',
    status: 'approved',
    statusNote: 'Approved by you',
    requestedLabel: '15 May 2025',
    requestedBy: "Liam O'Connor",
  },
];

/** 64 + 48 + 32 + 18 + 16 = 178, the figure in the middle of the donut. */
export const DEMO_LEAVE_COUNTS: LeaveTypeCount[] = [
  { type: 'annual', label: 'Annual Leave', days: 64 },
  { type: 'sick', label: 'Sick Leave', days: 48 },
  { type: 'personal', label: 'Personal Leave', days: 32 },
  { type: 'carer', label: "Carer's Leave", days: 18 },
  { type: 'other', label: 'Other', days: 16 },
];

export const DEMO_LEAVE_BALANCES: LeaveBalance[] = [
  {
    type: 'annual',
    label: 'Annual Leave',
    balanceDays: 18,
    allowanceDays: 28,
    fraction: 18 / 28,
  },
  {
    // The reference reads "Balance 9 days / Allowance 0 days" and still draws a
    // half-filled meter, which no ratio produces. The text is reproduced as
    // written; the meter is given the fill the reference draws.
    type: 'sick',
    label: 'Sick Leave',
    balanceDays: 9,
    allowanceDays: 0,
    fraction: 0.48,
  },
  {
    type: 'personal',
    label: 'Personal Leave',
    balanceDays: 5,
    allowanceDays: 10,
    fraction: 5 / 10,
  },
  {
    type: 'carer',
    label: "Carer's Leave",
    balanceDays: 3,
    allowanceDays: 5,
    fraction: 3 / 5,
  },
];

export const DEMO_LEAVE_APPROVALS: LeaveApprovalCount[] = [
  { id: 'leave', label: 'Leave requests', note: 'Needs your approval', count: 6 },
  // The reference labels this "2Swap requests". The leading 2 is the count
  // bleeding into the label in the mockup, not part of the name.
  { id: 'swaps', label: 'Swap requests', note: 'Needs your approval', count: 2 },
  { id: 'overtime', label: 'Overtime requests', note: 'Needs your approval', count: 1 },
];

/** The reference's footer: "Showing 1 to 8 of 24 requests", 10 rows per page. */
export const DEMO_LEAVE_TOTAL = 24;
export const DEMO_LEAVE_PAGE_SIZE = 10;
