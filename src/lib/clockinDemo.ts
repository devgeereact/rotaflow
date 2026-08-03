import { LifeBuoy, ScanLine, ShieldQuestion } from 'lucide-react';
import type { HelpLink } from '@/components/clockin/NeedHelpCard';
import type {
  AttendanceSummary,
  ClockActivityEntry,
  CurrentShiftInfo,
  TodayScheduleEntry,
  WeeklySummaryStat,
} from '@/lib/clockRows';

/**
 * Fixtures for `/clockin-preview` — the exact shift, times and figures printed
 * on design/clockin.png (including its frozen 08:48:37 clock), so the design
 * loop can screenshot the screen without a Supabase session, a staff profile or
 * a rostered shift. Nothing here reaches the live `/app/clock`, which computes
 * every one of these from real rows via `@/lib/clockRows`.
 *
 * See design/.loop/clockin-log.md.
 */

const HOME = 'Sunnyvale Care Home';

export const DEMO_CLOCK_TIME = '08:48:37';
export const DEMO_CLOCK_DATE = 'Thursday, 14 May 2026';
export const DEMO_WINDOW_LABEL = 'Within time window';
export const DEMO_WEEK_LABEL = '10 – 16 May 2026';

export const DEMO_POLICY = {
  title: 'Important',
  body: 'Please clock in within 15 minutes of your scheduled start time.',
} as const;

export const DEMO_SHIFT: CurrentShiftInfo = {
  countdownLabel: 'Starts in 12 min',
  timeRange: '09:00 – 17:00',
  dateLabel: 'Today, 14 May 2026',
  locationName: HOME,
  areaName: 'Care Home – Floor 2',
  roleName: 'Senior Care Assistant',
  shiftTypeName: 'Day Shift',
  breakRange: '12:30 – 13:00',
  breakDuration: '(30 min)',
  paidHours: '7h 30m',
  reminder: {
    title: 'Reminder',
    body: 'Please ensure you take your required breaks.',
  },
};

export const DEMO_SCHEDULE: TodayScheduleEntry[] = [
  {
    id: 'shift',
    timeRange: '09:00 – 17:00',
    title: 'Senior Care Assistant',
    locationName: HOME,
    badgeLabel: 'Upcoming',
    tone: 'upcoming',
  },
  {
    id: 'break',
    timeRange: '12:30 – 13:00',
    title: 'Unpaid Break',
    badgeLabel: 'Break',
    tone: 'break',
  },
];

export const DEMO_ACTIVITY: ClockActivityEntry[] = [
  {
    id: '1',
    kind: 'out',
    label: 'Clock Out',
    timeLabel: 'Yesterday, 17:02',
    locationName: HOME,
    durationLabel: '7h 32m',
  },
  {
    id: '2',
    kind: 'in',
    label: 'Clock In',
    timeLabel: 'Yesterday, 09:00',
    locationName: HOME,
  },
  {
    id: '3',
    kind: 'out',
    label: 'Clock Out',
    timeLabel: 'Tue, 12 May, 17:01',
    locationName: HOME,
    durationLabel: '7h 31m',
  },
];

export const DEMO_SUMMARY: WeeklySummaryStat[] = [
  { label: 'Scheduled Hours', value: '37h 30m' },
  { label: 'Worked Hours', value: '35h 02m' },
  { label: 'Break Hours', value: '0h 30m' },
  { label: 'Variance', value: '+2h 28m', positive: true },
];

export const DEMO_ATTENDANCE: AttendanceSummary = {
  tone: 'good',
  statusTitle: 'On Track',
  statusBody: "Great job! You're on track this week.",
  thisWeekValue: '100%',
  lastWeekValue: '98%',
};

export const DEMO_HELP: HelpLink[] = [
  { id: 'policy', icon: ShieldQuestion, label: 'Clock In / Out Policy' },
  { id: 'trouble', icon: ScanLine, label: 'Troubleshooting' },
  { id: 'support', icon: LifeBuoy, label: 'Contact Support' },
];

export const DEMO_FOOTER = {
  supportLine: 'Having issues clocking in?',
  contactLine: 'Contact support or call 0800 123 4567',
} as const;
