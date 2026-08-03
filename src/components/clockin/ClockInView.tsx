import type { ReactNode } from 'react';
import { Clock } from 'lucide-react';
import { AttendanceStatusCard } from '@/components/clockin/AttendanceStatusCard';
import { ClockActionPane } from '@/components/clockin/ClockActionPane';
import { ClockPolicyBanner } from '@/components/clockin/ClockPolicyBanner';
import { ClockSecurityFooter } from '@/components/clockin/ClockSecurityFooter';
import { CurrentShiftPane } from '@/components/clockin/CurrentShiftPane';
import { NeedHelpCard } from '@/components/clockin/NeedHelpCard';
import { RecentActivityCard } from '@/components/clockin/RecentActivityCard';
import { TodayScheduleCard } from '@/components/clockin/TodayScheduleCard';
import { WeeklySummaryCard } from '@/components/clockin/WeeklySummaryCard';
import type { HelpLink } from '@/components/clockin/NeedHelpCard';
import type {
  AttendanceSummary,
  ClockActivityEntry,
  ClockStage,
  CurrentShiftInfo,
  TodayScheduleEntry,
  WeeklySummaryStat,
} from '@/lib/clockRows';

export interface ClockInViewProps {
  policy: { title: string; body: string; onViewPolicy?: () => void };

  shift: CurrentShiftInfo | null;
  onViewReminder?: () => void;

  stage: ClockStage;
  /** Ticking wall clock, pre-formatted, e.g. "08:48:37". */
  clockTime: string;
  clockDateLabel: string;
  windowLabel: string;
  onPrimaryAction?: () => void;
  onSecondaryAction?: () => void;
  busy?: boolean;
  /** Rendered under the clock actions — the location picker on `/app/clock`. */
  actionExtra?: ReactNode;

  schedule: TodayScheduleEntry[];
  onViewFullSchedule?: () => void;

  activity: ClockActivityEntry[];
  onViewAllActivity?: () => void;

  weekly: {
    periodLabel: string;
    stats: WeeklySummaryStat[];
    completedPercent: number;
    progressLabel: string;
  };
  onViewTimesheet?: () => void;

  attendance: AttendanceSummary;
  onViewAttendanceReport?: () => void;

  help: HelpLink[];
  footer: { supportLine: string; contactLine: string; onReportIssue?: () => void };

  /** Offline / failed-write notices, above the grid. Preview passes nothing. */
  notices?: ReactNode;
}

/**
 * The whole clock-in screen (design/clockin.png), layout only.
 *
 * Owns no data and no clock: `/app/clock` feeds it Supabase rows mapped through
 * `@/lib/clockRows`, and `/clockin-preview` feeds it the frozen values from
 * `@/lib/clockinDemo`, so the design loop screenshots the same render tree the
 * product ships.
 *
 * Carries no outer padding — `AppShell` supplies `px-6 py-8 md:px-10` on the
 * live route, and the preview page supplies its own.
 */
export function ClockInView({
  policy,
  shift,
  onViewReminder,
  stage,
  clockTime,
  clockDateLabel,
  windowLabel,
  onPrimaryAction,
  onSecondaryAction,
  busy,
  actionExtra,
  schedule,
  onViewFullSchedule,
  activity,
  onViewAllActivity,
  weekly,
  onViewTimesheet,
  attendance,
  onViewAttendanceReport,
  help,
  footer,
  notices,
}: ClockInViewProps): JSX.Element {
  return (
    <>
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

      {notices}

      <div className="mt-6">
        <ClockPolicyBanner
          title={policy.title}
          body={policy.body}
          onViewPolicy={policy.onViewPolicy}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <div className="lg:col-span-8">
          {/* 7/5 split, not 50/50 — the reference gives Current Shift ~55% so
              "09:00 – 17:00" and the location rows each stay on one line. */}
          <div className="grid divide-y divide-surface-border overflow-hidden rounded-xl border border-surface-border bg-surface shadow-sm dark:divide-surface-border-dark dark:border-surface-border-dark dark:bg-surface-dark md:grid-cols-12 md:divide-x md:divide-y-0">
            <div className="md:col-span-7">
              <CurrentShiftPane shift={shift} onViewReminder={onViewReminder} />
            </div>
            <div className="md:col-span-5">
              <ClockActionPane
                stage={stage}
                clockTime={clockTime}
                dateLabel={clockDateLabel}
                windowLabel={windowLabel}
                onPrimary={onPrimaryAction}
                onSecondary={onSecondaryAction}
                busy={busy}
              >
                {actionExtra}
              </ClockActionPane>
            </div>
          </div>
        </div>

        <div className="space-y-5 lg:col-span-4">
          <TodayScheduleCard entries={schedule} onViewFull={onViewFullSchedule} />
          <RecentActivityCard entries={activity} onViewAll={onViewAllActivity} />
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <WeeklySummaryCard
            periodLabel={weekly.periodLabel}
            stats={weekly.stats}
            completedPercent={weekly.completedPercent}
            progressLabel={weekly.progressLabel}
            onViewTimesheet={onViewTimesheet}
          />
        </div>
        <div className="lg:col-span-3">
          <AttendanceStatusCard
            tone={attendance.tone}
            statusTitle={attendance.statusTitle}
            statusBody={attendance.statusBody}
            thisWeekLabel="This Week"
            thisWeekValue={attendance.thisWeekValue}
            lastWeekLabel="Last Week"
            lastWeekValue={attendance.lastWeekValue}
            onViewReport={onViewAttendanceReport}
          />
        </div>
        <div className="lg:col-span-4">
          <NeedHelpCard links={help} />
        </div>
      </div>

      <div className="mt-5">
        <ClockSecurityFooter
          supportLine={footer.supportLine}
          contactLine={footer.contactLine}
          onReportIssue={footer.onReportIssue}
        />
      </div>
    </>
  );
}
