import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  AlertTriangle,
  CalendarDays,
  CircleCheck,
  Repeat2,
  Umbrella,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/StatTile';
import { Sparkline } from '@/components/ui/TrendChart';
import { hoursLabel } from '@/components/dashboard/dashboardFormat';
import type { DashboardOverview, PendingRequest } from '@/services/dashboardService';
import type { WeeklyRosterSummary } from '@/services/dashboardService';

export interface ManagerDashboardProps {
  firstName: string | null;
  orgName: string;
  overview: DashboardOverview;
  pending: PendingRequest[];
  weekly: WeeklyRosterSummary | null;
  /** Total rostered hours for each of the last 7 weeks, oldest first. */
  hoursTrend: number[];
}

interface Blocker {
  key: string;
  message: string;
}

/** The blocking half of `weekly`: over the 48-hour statutory limit, or a day short of the org's minimum cover. Mirrors `docs/ORGANISATION_WORKSPACE.html`'s `conflicts()`/`blockers()`. */
function blockersFor(weekly: WeeklyRosterSummary): Blocker[] {
  const out: Blocker[] = [];
  for (const person of weekly.overLimitStaff) {
    if (!person.overStatutory) continue;
    out.push({
      key: `staff-${person.staffName}`,
      message: `${person.staffName} is rostered ${hoursLabel(person.hours)}. Over the 48-hour weekly limit.`,
    });
  }
  for (const day of weekly.coverByDate) {
    if (day.onShift >= day.required) continue;
    const label = format(new Date(`${day.date}T00:00:00`), 'EEEE');
    out.push({
      key: `day-${day.date}`,
      message: `${label} is ${day.required - day.onShift} short of the ${day.required}-person minimum.`,
    });
  }
  return out;
}

/**
 * The manager's home screen (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.dashboard` manager branch): this week's cover against the org's
 * staffing minimum, the rota's publish state, and what needs a decision.
 */
export function ManagerDashboard({
  firstName,
  orgName,
  overview,
  pending,
  weekly,
  hoursTrend,
}: ManagerDashboardProps): JSX.Element {
  const blockers = weekly ? blockersFor(weekly) : [];
  const shiftsToFill = weekly
    ? weekly.coverByDate.reduce((sum, d) => sum + Math.max(0, d.required - d.onShift), 0)
    : 0;
  const todayIso = format(new Date(), 'yyyy-MM-dd');
  const today = weekly?.coverByDate.find((d) => d.date === todayIso);
  const pendingLeave = pending.filter((p) => p.kind === 'leave');
  const pendingSwaps = pending.filter((p) => p.kind === 'swap');
  const oldestLeaveDays = pendingLeave.length
    ? Math.max(
        0,
        Math.round(
          (Date.now() -
            new Date(
              pendingLeave.reduce((oldest, r) =>
                r.createdAt < oldest.createdAt ? r : oldest,
              ).createdAt,
            ).getTime()) /
            86_400_000,
        ),
      )
    : 0;
  const maxDeptHours = Math.max(
    1,
    ...(weekly?.hoursByDepartment.map((d) => d.hours) ?? [1]),
  );
  const maxCover = Math.max(1, ...(weekly?.coverByDate.map((d) => d.onShift + 3) ?? [1]));

  return (
    <div className="max-w-[1600px]">
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <div>
          <h1 className="font-display text-page-title font-semibold text-content dark:text-content-dark">
            Good morning{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-content-muted dark:text-content-muted-dark">
            {format(new Date(), 'EEEE d MMMM')} · {orgName} · {overview.locations.length}{' '}
            location{overview.locations.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link
            to="/app/announcements"
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-surface-border bg-surface px-5 font-semibold text-content transition-transform duration-150 ease-in-out hover:scale-[1.02] hover:bg-surface-subtle active:scale-[0.98] dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
          >
            Post announcement
          </Link>
          <Link
            to="/app/rota"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-fg transition-transform duration-150 ease-in-out hover:scale-[1.02] hover:bg-primary/90 active:scale-[0.98]"
          >
            <CalendarDays size={16} aria-hidden="true" />
            Open rota builder
          </Link>
        </div>
      </div>

      {blockers.length > 0 && (
        <Callout
          tone="danger"
          className="mb-6"
          title={`${blockers.length} ${blockers.length === 1 ? 'conflict needs' : 'conflicts need'} attention before this week publishes.`}
        >
          {blockers[0]!.message}
          {blockers.length > 1 ? ` And ${blockers.length - 1} more.` : ''}{' '}
          <Link
            to="/app/rota"
            className="font-medium text-primary-ink hover:underline dark:text-primary"
          >
            Open the rota builder
          </Link>
          .
        </Callout>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Rostered this week"
          value={weekly ? hoursLabel(weekly.totalHours) : '—'}
          hint={`across ${overview.staff.length} staff`}
          chart={<Sparkline values={hoursTrend} />}
        />
        <StatTile
          label="Shifts to fill"
          value={shiftsToFill}
          hint={
            shiftsToFill > 0 ? (
              <span className="text-danger-ink dark:text-danger">
                below minimum cover
              </span>
            ) : (
              'fully covered'
            )
          }
          to="/app/rota"
        />
        <StatTile
          label="Leave to decide"
          value={pendingLeave.length}
          hint={
            pendingLeave.length
              ? `oldest ${oldestLeaveDays} day${oldestLeaveDays === 1 ? '' : 's'} old`
              : 'nothing pending'
          }
          to="/app/leave"
        />
        <StatTile label="Swaps waiting" value={pendingSwaps.length} to="/app/swaps" />
        <StatTile
          label="On shift now"
          value={today?.onShift ?? 0}
          hint={`of ${today?.required ?? 0} required`}
          to="/app/schedule"
        />
        <StatTile
          label="Rota status"
          value={weekly?.rotaStatus === 'published' ? 'Published' : 'Draft'}
          hint={
            weekly?.rotaStatus === 'published' ? (
              <span className="text-success">staff notified</span>
            ) : (
              <span className="text-danger-ink dark:text-danger">
                not visible to staff
              </span>
            )
          }
          to="/app/rota"
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-semibold text-content dark:text-content-dark">
              Cover against minimum
            </h2>
            <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-xs text-content-muted dark:bg-surface-subtle-dark dark:text-content-muted-dark">
              Week commencing{' '}
              {weekly
                ? format(new Date(`${weekly.coverByDate[0]?.date}T00:00:00`), 'd MMM')
                : '—'}
            </span>
          </div>
          <div className="grid h-[220px] grid-cols-7 gap-2">
            {(weekly?.coverByDate ?? []).map((day) => {
              const short = day.onShift < day.required;
              const pct = Math.min(100, (day.onShift / maxCover) * 100);
              const requiredPct = Math.min(100, (day.required / maxCover) * 100);
              return (
                <div key={day.date} className="flex h-full flex-col items-center gap-1.5">
                  <div className="relative flex w-full flex-1 items-end border-b border-surface-border dark:border-surface-border-dark">
                    <span
                      className="absolute left-0 right-0 border-t border-dashed border-warning"
                      style={{ bottom: `${requiredPct}%` }}
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        'w-full rounded-t-lg',
                        short ? 'bg-danger' : 'bg-primary',
                      )}
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      'font-mono text-xs font-semibold',
                      short ? 'text-danger' : 'text-content dark:text-content-dark',
                    )}
                  >
                    {day.onShift}
                  </span>
                  <span className="text-[11px] text-content-muted dark:text-content-muted-dark">
                    {format(new Date(`${day.date}T00:00:00`), 'EEE')}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-content-muted dark:text-content-muted-dark">
            The dashed line is each day&rsquo;s staffing minimum, summed from every
            site&rsquo;s own setting in{' '}
            <Link
              to="/app/locations"
              className="font-medium text-primary-ink hover:underline dark:text-primary"
            >
              Locations
            </Link>
            . It can differ by day and by site, a bigger Saturday minimum shows as a
            taller line. Bars below it are the days that block publication.
          </p>
        </Card>

        <div className="grid gap-6">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold text-content dark:text-content-dark">
              Needs you
            </h2>
            {pending.length === 0 ? (
              <div className="flex items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-success-wash text-success dark:bg-success-wash-dark">
                  <CircleCheck size={15} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-medium text-content dark:text-content-dark">
                    All caught up
                  </p>
                  <p className="text-sm text-content-muted dark:text-content-muted-dark">
                    Nothing needs your attention right now.
                  </p>
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
                {pending.slice(0, 4).map((request) => (
                  <li key={request.id} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span
                      className={cn(
                        'grid h-8 w-8 shrink-0 place-items-center rounded-full',
                        request.kind === 'leave'
                          ? 'bg-warning-wash text-warning-ink dark:bg-warning-wash-dark dark:text-warning'
                          : request.kind === 'swap'
                            ? 'bg-info-wash text-info dark:bg-info-wash-dark'
                            : 'bg-danger-wash text-danger dark:bg-danger-wash-dark',
                      )}
                    >
                      {request.kind === 'leave' ? (
                        <Umbrella size={15} aria-hidden="true" />
                      ) : request.kind === 'swap' ? (
                        <Repeat2 size={15} aria-hidden="true" />
                      ) : (
                        <AlertTriangle size={15} aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-content dark:text-content-dark">
                        {request.staffName} · {request.detail}
                      </p>
                      <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                        {request.dateLabel} ·{' '}
                        <Link
                          to={
                            request.kind === 'leave'
                              ? '/app/leave'
                              : request.kind === 'swap'
                                ? '/app/swaps'
                                : '/app/timesheets'
                          }
                          className="font-medium text-primary-ink hover:underline dark:text-primary"
                        >
                          {request.kind === 'missed_clock_in' ? 'Timesheets' : 'Decide'}
                        </Link>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-semibold text-content dark:text-content-dark">
              Hours by department
            </h2>
            {!weekly || weekly.hoursByDepartment.length === 0 ? (
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                No shifts rostered this week yet.
              </p>
            ) : (
              <div className="space-y-2.5">
                {weekly.hoursByDepartment.map((d) => (
                  <div
                    key={d.name}
                    className="grid grid-cols-[88px_1fr_56px] items-center gap-2.5"
                  >
                    <span className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                      {d.name}
                    </span>
                    <span className="h-2 overflow-hidden rounded-full border border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${(d.hours / maxDeptHours) * 100}%` }}
                      />
                    </span>
                    <span className="text-right font-mono text-xs text-content dark:text-content-dark">
                      {hoursLabel(d.hours)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
