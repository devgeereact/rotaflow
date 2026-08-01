import { Award, BarChart3, CalendarDays, MapPin, Star, Timer, TimerReset } from 'lucide-react';
import type { QuickAction } from '@/components/timesheets/QuickActionsCard';
import type { SwapActivityEntry } from '@/components/swaps/SwapActivityCard';
import type { SwapRule } from '@/components/swaps/SwapRulesCard';
import type { SwapRow, SwapStatusCount } from '@/lib/swapRows';

/**
 * Fixtures for `/swaps-preview` — the exact people, shifts and figures printed
 * on design/Swap-Request.png, so the design loop can screenshot the screen
 * without a Supabase session, an org or seeded rows. Nothing here reaches the
 * live `/app/swaps`; see design/.loop/swaps-log.md.
 */

const SUNSHINE = 'Sunshine Care Home';
const RIVERSIDE = 'Riverside House';
const OAKVIEW = 'Oakview Care Home';

export const DEMO_SWAP_PERIOD = '26 May – 1 June 2025';

export const DEMO_SWAP_ROWS: SwapRow[] = [
  {
    id: 'swap-1',
    from: {
      firstName: 'Emily',
      lastName: 'Davis',
      jobTitle: 'Care Assistant',
      photoUrl: null,
    },
    to: { firstName: 'Aisha', lastName: 'Patel', jobTitle: 'Senior Nurse', photoUrl: null },
    shift: {
      dateLabel: 'Tue 27 May 2025',
      timeLabel: '07:00 – 15:00',
      locationName: SUNSHINE,
    },
    requestedLabel: 'Today, 09:15',
    requestedByName: 'Emily Davis',
    status: 'pending',
    statusNote: 'Needs your approval',
    needsReview: true,
  },
  {
    id: 'swap-2',
    from: {
      firstName: 'Daniel',
      lastName: 'Lee',
      jobTitle: 'Care Assistant',
      photoUrl: null,
    },
    to: {
      firstName: 'Michael',
      lastName: 'Brown',
      jobTitle: 'Care Assistant',
      photoUrl: null,
    },
    shift: {
      dateLabel: 'Wed 28 May 2025',
      timeLabel: '15:00 – 23:00',
      locationName: RIVERSIDE,
    },
    requestedLabel: 'Yesterday, 16:40',
    requestedByName: 'Daniel Lee',
    status: 'approved',
    statusNote: 'Approved by you',
    needsReview: false,
  },
  {
    id: 'swap-3',
    from: {
      firstName: 'Sarah',
      lastName: 'Johnson',
      jobTitle: 'Senior Nurse',
      photoUrl: null,
    },
    to: {
      firstName: 'James',
      lastName: 'Wilson',
      jobTitle: 'Care Assistant',
      photoUrl: null,
    },
    shift: {
      dateLabel: 'Thu 29 May 2025',
      timeLabel: '07:00 – 15:00',
      locationName: SUNSHINE,
    },
    requestedLabel: '25 May 2025, 11:20',
    requestedByName: 'James Wilson',
    status: 'declined',
    statusNote: 'Insufficient cover',
    needsReview: false,
  },
  {
    id: 'swap-4',
    from: { firstName: 'Aisha', lastName: 'Patel', jobTitle: 'Senior Nurse', photoUrl: null },
    to: {
      firstName: 'Grace',
      lastName: 'Thompson',
      jobTitle: 'Senior Nurse',
      photoUrl: null,
    },
    shift: {
      dateLabel: 'Fri 30 May 2025',
      timeLabel: '15:00 – 23:00',
      locationName: OAKVIEW,
    },
    requestedLabel: '24 May 2025, 13:05',
    requestedByName: 'Aisha Patel',
    status: 'approved',
    statusNote: 'Approved by you',
    needsReview: false,
  },
  {
    id: 'swap-5',
    from: {
      firstName: 'Michael',
      lastName: 'Brown',
      jobTitle: 'Care Assistant',
      photoUrl: null,
    },
    to: {
      firstName: 'Daniel',
      lastName: 'Lee',
      jobTitle: 'Care Assistant',
      photoUrl: null,
    },
    shift: {
      dateLabel: 'Sat 31 May 2025',
      timeLabel: '07:00 – 15:00',
      locationName: RIVERSIDE,
    },
    requestedLabel: '24 May 2025, 08:45',
    requestedByName: 'Michael Brown',
    status: 'pending',
    statusNote: 'Needs your approval',
    needsReview: true,
  },
  {
    id: 'swap-6',
    from: {
      firstName: 'Liam',
      lastName: "O'Connor",
      jobTitle: 'Care Assistant',
      photoUrl: null,
    },
    to: {
      firstName: 'Emily',
      lastName: 'Davis',
      jobTitle: 'Care Assistant',
      photoUrl: null,
    },
    shift: {
      dateLabel: 'Sun 1 June 2025',
      timeLabel: '15:00 – 23:00',
      locationName: SUNSHINE,
    },
    requestedLabel: '23 May 2025, 17:30',
    requestedByName: "Liam O'Connor",
    status: 'cancelled',
    statusNote: 'Cancelled by requester',
    needsReview: false,
  },
];

/**
 * The reference shows 12 requests across 2 pages while listing 6 — these are
 * the whole-period totals behind the tabs and the donut, not a count of
 * `DEMO_SWAP_ROWS`.
 */
export const DEMO_SWAP_TOTAL = 12;

export const DEMO_SWAP_COUNTS: SwapStatusCount[] = [
  { status: 'pending', label: 'Pending Approval', count: 5 },
  { status: 'approved', label: 'Approved', count: 4 },
  { status: 'declined', label: 'Declined', count: 2 },
  { status: 'cancelled', label: 'Cancelled', count: 1 },
];

export const DEMO_SWAP_RULES: SwapRule[] = [
  { id: 'notice', icon: Timer, label: 'Minimum notice period', value: '24 hours' },
  { id: 'skill', icon: Award, label: 'Same skill level required', value: 'Yes' },
  { id: 'location', icon: MapPin, label: 'Same location required', value: 'Yes' },
  { id: 'max', icon: TimerReset, label: 'Max swaps per month', value: '2' },
  { id: 'approval', icon: Star, label: 'Manager approval required', value: 'Yes' },
];

export const DEMO_SWAP_ACTIVITY: SwapActivityEntry[] = [
  {
    id: 'act-1',
    kind: 'approved',
    title: "Aisha Patel's swap was approved",
    detail: 'With Grace Thompson',
    timeLabel: 'Today, 10:15',
  },
  {
    id: 'act-2',
    kind: 'declined',
    title: "Sarah Johnson's swap was declined",
    detail: 'With James Wilson',
    timeLabel: 'Yesterday, 15:20',
  },
  {
    id: 'act-3',
    kind: 'requested',
    title: 'New swap request received',
    detail: 'Daniel Lee → Emily Davis',
    timeLabel: 'Yesterday, 14:10',
  },
];

export const DEMO_SWAP_QUICK_ACTIONS: QuickAction[] = [
  { id: 'calendar', icon: CalendarDays, label: 'Team Calendar', to: '/app/schedule' },
  { id: 'report', icon: BarChart3, label: 'Swap Report', to: '/app/reports' },
];
