import { Clock, LifeBuoy, ScanLine, ShieldQuestion } from 'lucide-react';
import { AttendanceStatusCard } from '@/components/clockin/AttendanceStatusCard';
import { ClockActionPane } from '@/components/clockin/ClockActionPane';
import { ClockPolicyBanner } from '@/components/clockin/ClockPolicyBanner';
import { ClockSecurityFooter } from '@/components/clockin/ClockSecurityFooter';
import { CurrentShiftPane } from '@/components/clockin/CurrentShiftPane';
import { NeedHelpCard } from '@/components/clockin/NeedHelpCard';
import { RecentActivityCard } from '@/components/clockin/RecentActivityCard';
import { TodayScheduleCard } from '@/components/clockin/TodayScheduleCard';
import { WeeklySummaryCard } from '@/components/clockin/WeeklySummaryCard';
import type { CurrentShiftInfo } from '@/components/clockin/CurrentShiftPane';
import type { ClockActivityEntry } from '@/components/clockin/RecentActivityCard';
import type { HelpLink } from '@/components/clockin/NeedHelpCard';
import type { TodayScheduleEntry } from '@/components/clockin/TodayScheduleCard';
import type { WeeklySummaryStat } from '@/components/clockin/WeeklySummaryCard';

/**
 * Design-loop preview only — `/app/clock-in` needs a real Supabase session, a
 * staff profile and a scheduled shift. This renders the same components
 * against fixed mock data so the screen can be screenshotted without auth or a
 * database, reproducing design/clockin.png's values exactly (including its
 * frozen 08:48:37 clock). See design/.loop/clockin-log.md.
 *
 * The reference also shows the sidebar and top bar; those belong to AppShell,
 * and every design-loop preview in this repo renders page content only.
 */

const SHIFT: CurrentShiftInfo = {
  countdownLabel: 'Starts in 12 min',
  timeRange: '09:00 – 17:00',
  dateLabel: 'Today, 14 May 2026',
  locationName: 'Sunnyvale Care Home',
  areaName: 'Care Home – Floor 2',
  roleName: 'Senior Care Assistant',
  shiftTypeName: 'Day Shift',
  breakRange: '12:30 – 13:00',
  breakDuration: '(30 min)',
  paidHours: '7h 30m',
  reminderTitle: 'Reminder',
  reminderBody: 'Please ensure you take your required breaks.',
};

const SCHEDULE: TodayScheduleEntry[] = [
  {
    id: 'shift',
    timeRange: '09:00 – 17:00',
    title: 'Senior Care Assistant',
    locationName: 'Sunnyvale Care Home',
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

const ACTIVITY: ClockActivityEntry[] = [
  {
    id: '1',
    kind: 'out',
    label: 'Clock Out',
    timeLabel: 'Yesterday, 17:02',
    locationName: 'Sunnyvale Care Home',
    durationLabel: '7h 32m',
  },
  {
    id: '2',
    kind: 'in',
    label: 'Clock In',
    timeLabel: 'Yesterday, 09:00',
    locationName: 'Sunnyvale Care Home',
  },
  {
    id: '3',
    kind: 'out',
    label: 'Clock Out',
    timeLabel: 'Tue, 12 May, 17:01',
    locationName: 'Sunnyvale Care Home',
    durationLabel: '7h 31m',
  },
];

const SUMMARY: WeeklySummaryStat[] = [
  { label: 'Scheduled Hours', value: '37h 30m' },
  { label: 'Worked Hours', value: '35h 02m' },
  { label: 'Break Hours', value: '0h 30m' },
  { label: 'Variance', value: '+2h 28m', positive: true },
];

const HELP: HelpLink[] = [
  { id: 'policy', icon: ShieldQuestion, label: 'Clock In / Out Policy' },
  { id: 'trouble', icon: ScanLine, label: 'Troubleshooting' },
  { id: 'support', icon: LifeBuoy, label: 'Contact Support' },
];

export function ClockInPreviewPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-background px-6 py-6 dark:bg-background-dark">
      <header className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary dark:bg-primary/15">
          <Clock size={20} aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-page-title font-semibold leading-tight text-content dark:text-content-dark">
            Clock In
          </h1>
          <p className="text-base text-content-muted dark:text-content-muted-dark">
            Track your attendance and stay on schedule.
          </p>
        </div>
      </header>

      <div className="mt-6">
        <ClockPolicyBanner
          title="Important"
          body="Please clock in within 15 minutes of your scheduled start time."
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <div className="lg:col-span-8">
          {/* 7/5 split, not 50/50 — the reference gives Current Shift ~55% so
              "09:00 – 17:00" and the location rows each stay on one line. */}
          <div className="grid divide-y divide-surface-border overflow-hidden rounded-xl border border-surface-border bg-surface shadow-sm dark:divide-surface-border-dark dark:border-surface-border-dark dark:bg-surface-dark md:grid-cols-12 md:divide-x md:divide-y-0">
            <div className="md:col-span-7">
              <CurrentShiftPane shift={SHIFT} />
            </div>
            <div className="md:col-span-5">
              <ClockActionPane
                clockTime="08:48:37"
                dateLabel="Thursday, 14 May 2026"
                windowLabel="Within time window"
              />
            </div>
          </div>
        </div>

        <div className="space-y-5 lg:col-span-4">
          <TodayScheduleCard entries={SCHEDULE} />
          <RecentActivityCard entries={ACTIVITY} />
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <WeeklySummaryCard
            periodLabel="10 – 16 May 2026"
            stats={SUMMARY}
            completedPercent={93}
            progressLabel="93% of scheduled hours completed"
          />
        </div>
        <div className="lg:col-span-3">
          <AttendanceStatusCard
            statusTitle="On Track"
            statusBody="Great job! You're on track this week."
            thisWeekLabel="This Week"
            thisWeekValue="100%"
            lastWeekLabel="Last Week"
            lastWeekValue="98%"
          />
        </div>
        <div className="lg:col-span-4">
          <NeedHelpCard links={HELP} />
        </div>
      </div>

      <div className="mt-5">
        <ClockSecurityFooter
          supportLine="Having issues clocking in?"
          contactLine="Contact support or call 0800 123 4567"
        />
      </div>
    </div>
  );
}
