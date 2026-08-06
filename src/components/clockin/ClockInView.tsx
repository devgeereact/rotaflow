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
  /** Rendered under the clock actions. The location picker on `/app/clock`. */
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
 * Carries no outer padding, `AppShell` supplies `px-6 py-8 md:px-10` on the
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

      {/*
        Both rows are 12-column grids on the SAME column track, and every cell
        is `h-full`.

        Neither was true before, and the screen showed it: the right rail
        (Today's Schedule + Recent Activity) is naturally taller than the shift
        card beside it, so the grid row grew to the rail's height while the
        shift card kept its own. Leaving the two columns ending 60px apart. The
        row-2 cards had the same latent problem, held together only by their
        content happening to be the same height.

        `h-full` on each cell plus `h-full` inside each card is what makes a
        row end on one line regardless of what is in it. The grid's default
        `items-stretch` stretches the *cell*; without the card also filling that
        cell, the card just sits at its natural height inside a taller box.
      */}
      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <div className="lg:col-span-8">
          {/* 7/5 split, not 50/50. The reference gives Current Shift ~55% so
              "09:00-17:00" and the location rows each stay on one line. */}
          <div className="grid h-full divide-y divide-surface-border overflow-hidden rounded-xl border border-surface-border bg-surface shadow-sm dark:divide-surface-border-dark dark:border-surface-border-dark dark:bg-surface-dark md:grid-cols-12 md:divide-x md:divide-y-0">
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

        {/* `flex` + `flex-1` on the last card rather than `space-y-5`: the rail
            has to fill the row exactly, and Recent Activity is the item that
            should absorb the slack. It is a list, so extra height shows more
            of it rather than stretching a fixed layout. */}
        <div className="flex flex-col gap-5 lg:col-span-4">
          <TodayScheduleCard entries={schedule} onViewFull={onViewFullSchedule} />
          <div className="flex-1">
            <RecentActivityCard entries={activity} onViewAll={onViewAllActivity} />
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <div className="h-full lg:col-span-5">
          <WeeklySummaryCard
            periodLabel={weekly.periodLabel}
            stats={weekly.stats}
            completedPercent={weekly.completedPercent}
            progressLabel={weekly.progressLabel}
            onViewTimesheet={onViewTimesheet}
          />
        </div>
        <div className="h-full lg:col-span-3">
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
        <div className="h-full lg:col-span-4">
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
