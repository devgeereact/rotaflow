import type { ReactNode } from 'react';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { AttendanceStatusCard } from '@/components/clockin/AttendanceStatusCard';
import { ClockActionPane } from '@/components/clockin/ClockActionPane';
import { ClockPolicyBanner } from '@/components/clockin/ClockPolicyBanner';
import { ClockSecurityFooter } from '@/components/clockin/ClockSecurityFooter';
import { CurrentShiftPane } from '@/components/clockin/CurrentShiftPane';
import { NeedHelpCard } from '@/components/clockin/NeedHelpCard';
import { RecentActivityCard } from '@/components/clockin/RecentActivityCard';
import { WeeklySummaryCard } from '@/components/clockin/WeeklySummaryCard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MobileDisclosure } from '@/components/ui/MobileDisclosure';
import { ScrollRegion } from '@/components/ui/ScrollRegion';
import type { HelpLink } from '@/components/clockin/NeedHelpCard';
import type {
  AttendanceSummary,
  ClockActivityEntry,
  ClockStage,
  CurrentShiftInfo,
  ThisWeekRow,
  WeeklySummaryStat,
} from '@/lib/clockRows';
import { syncStatusLabel } from '@/lib/clockRows';

const STAGE_LABEL: Record<ClockStage, string> = {
  ready: 'Off',
  working: 'Clocked in',
  break: 'On break',
  done: 'Clocked out',
};

export interface ClockInViewProps {
  policy: { title: string; body: string; onViewPolicy?: () => void };

  shift: CurrentShiftInfo | null;
  onViewReminder?: () => void;

  stage: ClockStage;
  /**
   * True when the most recent clock event exists only in this device's outbox.
   * The action is real and will replay, but Postgres does not have it yet, so
   * the Status row must not present it as a recorded fact.
   */
  latestIsPending?: boolean;
  /**
   * How many writes are waiting in the outbox. Drives the Sync row, which used
   * to read `navigator.onLine` alone and so printed "Synced" while a transient
   * failure had left items queued.
   */
  pendingCount?: number;
  /** Ticking wall clock, pre-formatted, e.g. "08:48:37". */
  clockTime: string;
  clockDateLabel: string;
  windowLabel: string;
  onPrimaryAction?: () => void;
  onSecondaryAction?: () => void;
  /** The manual fallback, present only once the device has failed to supply a position. */
  tertiaryActionLabel?: string;
  onTertiaryAction?: () => void;
  /** Replaces the pane's "your location will be recorded" footer note. */
  locationNote?: ReactNode;
  busy?: boolean;
  /** Rendered under the clock actions. The location picker on `/app/clock`. */
  actionExtra?: ReactNode;

  /** True when this device has a connection. Drives the "Sync" row. */
  online: boolean;

  thisWeekRows: ThisWeekRow[];
  onViewTimesheet?: () => void;

  activity: ClockActivityEntry[];
  onViewAllActivity?: () => void;

  weekly: {
    periodLabel: string;
    stats: WeeklySummaryStat[];
    completedPercent: number;
    progressLabel: string;
  };

  attendance: AttendanceSummary;
  onViewAttendanceReport?: () => void;

  help: HelpLink[];
  footer: { supportLine: string; contactLine: string; onReportIssue?: () => void };

  /** Offline / failed-write notices, above the grid. Preview passes nothing. */
  notices?: ReactNode;
}

/**
 * The whole clock-in screen (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.clock`): shift + clock action on the left, "Today" and "This
 * week" on the right — the reference's own two cards. Weekly variance,
 * attendance trend, recent activity and help links are real, additive
 * capability the reference has no equivalent for; they stay, one row down,
 * rather than competing with the reference's own layout for the top of the
 * screen.
 *
 * Owns no data and no clock: `/app/clock` feeds it Supabase rows mapped
 * through `@/lib/clockRows`, and `/clockin-preview` feeds it the frozen
 * values from `@/lib/clockinDemo`, so the design loop screenshots the same
 * render tree the product ships.
 *
 * Carries no outer padding, `AppShell` supplies `px-6 py-8 md:px-10` on the
 * live route, and the preview page supplies its own.
 */
export function ClockInView({
  policy,
  shift,
  onViewReminder,
  stage,
  latestIsPending = false,
  pendingCount = 0,
  clockTime,
  clockDateLabel,
  windowLabel,
  onPrimaryAction,
  onSecondaryAction,
  tertiaryActionLabel,
  onTertiaryAction,
  locationNote,
  busy,
  actionExtra,
  online,
  thisWeekRows,
  onViewTimesheet,
  activity,
  onViewAllActivity,
  weekly,
  attendance,
  onViewAttendanceReport,
  help,
  footer,
  notices,
}: ClockInViewProps): JSX.Element {
  const syncLabel = syncStatusLabel(online, pendingCount);

  return (
    <>
      <WorkspaceHeader
        title="Clock in"
        subtitle="Attendance is captured with your location and works offline. An entry made without signal queues on the device and syncs when you're back."
      />

      {/* Offline and failed-write notices stay directly under the title: they
          are the reason an action may not have done what it looked like it
          did, and they must not be behind a disclosure. */}
      {notices}

      {/* The clock action first.
          ------------------------------------------------------------------
          On a 390px screen this block used to open with a policy banner and
          a full shift card, which put `Clock In Now` 1,370px down the page —
          three phone screens past the fold, on the one screen whose entire
          purpose is a single button. The DOM order is now action, then shift
          detail; `order` restores the reference's shift-left/action-right
          arrangement from `md` up, where both fit side by side anyway. */}
      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          {/* 7/5 split, not 50/50. The reference gives Current Shift ~55% so
              "09:00–17:00" and the location rows each stay on one line. */}
          <div className="grid h-full divide-y divide-surface-border overflow-hidden rounded-xl border border-surface-border bg-surface shadow-sm dark:divide-surface-border-dark dark:border-surface-border-dark dark:bg-surface-dark md:grid-cols-12 md:divide-x md:divide-y-0">
            <div className="order-2 min-w-0 md:order-1 md:col-span-7">
              <CurrentShiftPane shift={shift} onViewReminder={onViewReminder} />
            </div>
            <div className="order-1 min-w-0 md:order-2 md:col-span-5">
              <ClockActionPane
                stage={stage}
                clockTime={clockTime}
                dateLabel={clockDateLabel}
                windowLabel={windowLabel}
                onPrimary={onPrimaryAction}
                onSecondary={onSecondaryAction}
                tertiaryLabel={tertiaryActionLabel}
                onTertiary={onTertiaryAction}
                locationNote={locationNote}
                busy={busy}
              >
                {actionExtra}
              </ClockActionPane>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-5 lg:col-span-5">
          <Card className="p-0">
            <div className="border-b border-surface-border px-5 py-4 dark:border-surface-border-dark">
              <h2 className="font-semibold text-content dark:text-content-dark">Today</h2>
            </div>
            <dl className="divide-y divide-surface-border text-sm dark:divide-surface-border-dark">
              <div className="flex items-center justify-between gap-4 px-5 py-3">
                <dt className="text-content-muted dark:text-content-muted-dark">
                  Scheduled
                </dt>
                <dd className="font-medium text-content dark:text-content-dark">
                  {shift ? `${shift.shiftTypeName}, ${shift.timeRange}` : 'Not scheduled'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-5 py-3">
                <dt className="text-content-muted dark:text-content-muted-dark">Site</dt>
                <dd className="font-medium text-content dark:text-content-dark">
                  {shift?.locationName ?? '-'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-5 py-3">
                <dt className="text-content-muted dark:text-content-muted-dark">Break</dt>
                <dd className="font-medium text-content dark:text-content-dark">
                  {shift ? `${shift.breakRange} ${shift.breakDuration}` : '-'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-5 py-3">
                <dt className="text-content-muted dark:text-content-muted-dark">
                  Status
                </dt>
                <dd className="text-right font-medium text-content dark:text-content-dark">
                  {STAGE_LABEL[stage]}
                  {latestIsPending ? (
                    <span className="block text-xs font-normal text-warning-ink dark:text-warning-ink-dark">
                      Saved on this device, not sent yet
                    </span>
                  ) : null}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-5 py-3">
                <dt className="text-content-muted dark:text-content-muted-dark">Sync</dt>
                <dd
                  className={
                    pendingCount > 0 || !online
                      ? 'font-medium text-warning-ink dark:text-warning-ink-dark'
                      : 'font-medium text-success-ink dark:text-success-ink-dark'
                  }
                >
                  {syncLabel}
                </dd>
              </div>
            </dl>
          </Card>

          <MobileDisclosure
            title="This week"
            hint={thisWeekRows.length === 0 ? 'No shifts' : `${thisWeekRows.length} days`}
            className="flex-1"
          >
            <Card className="h-full p-0">
              <div className="flex items-center justify-between gap-3 border-b border-surface-border px-5 py-4 dark:border-surface-border-dark">
                <h2 className="font-semibold text-content dark:text-content-dark">
                  This week
                </h2>
                {onViewTimesheet && (
                  <Button size="sm" variant="secondary" onClick={onViewTimesheet}>
                    Timesheet
                  </Button>
                )}
              </div>
              {thisWeekRows.length === 0 ? (
                <p className="px-5 py-6 text-sm text-content-muted dark:text-content-muted-dark">
                  No shifts scheduled this week.
                </p>
              ) : (
                <ScrollRegion label="This week's hours">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-border text-left text-xs font-semibold uppercase tracking-wide text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
                        <th className="px-5 py-2.5">Day</th>
                        <th className="px-3 py-2.5">Planned</th>
                        <th className="px-3 py-2.5">Actual</th>
                        <th className="px-5 py-2.5 text-right">Paid</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-border dark:divide-surface-border-dark">
                      {thisWeekRows.map((row) => (
                        <tr key={row.id}>
                          <td className="px-5 py-2.5 text-content dark:text-content-dark">
                            {row.dateLabel}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-content-muted dark:text-content-muted-dark">
                            {row.plannedLabel}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-content-muted dark:text-content-muted-dark">
                            {row.actualLabel}
                          </td>
                          <td className="px-5 py-2.5 text-right font-mono text-xs text-content dark:text-content-dark">
                            {row.paidLabel}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollRegion>
              )}
            </Card>
          </MobileDisclosure>
        </div>
      </div>

      {/* The policy reminder sits under the action, not above it. It explains
          the rule the button is subject to; it does not block the button, and
          on a phone it was 90px of explanation before anything could be
          done. */}
      <div className="mt-5">
        <ClockPolicyBanner
          title={policy.title}
          body={policy.body}
          onViewPolicy={policy.onViewPolicy}
        />
      </div>

      {/* Everything below is context: last week's variance, the attendance
          trend, the audit trail and the help links. Real capability, none of
          it what somebody starting a shift came here for, so it collapses on
          a phone and stays open on a desktop where it costs nothing. */}
      <MobileDisclosure
        title="Your hours and history"
        hint={`${activity.length} recent`}
        className="mt-5"
      >
        <div className="grid gap-5 lg:grid-cols-12">
          <div className="h-full min-w-0 lg:col-span-3">
            <WeeklySummaryCard
              periodLabel={weekly.periodLabel}
              stats={weekly.stats}
              completedPercent={weekly.completedPercent}
              progressLabel={weekly.progressLabel}
              onViewTimesheet={onViewTimesheet}
            />
          </div>
          <div className="h-full min-w-0 lg:col-span-3">
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
          <div className="h-full min-w-0 lg:col-span-3">
            <RecentActivityCard entries={activity} onViewAll={onViewAllActivity} />
          </div>
          <div className="h-full min-w-0 lg:col-span-3">
            <NeedHelpCard links={help} />
          </div>
        </div>
      </MobileDisclosure>

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
