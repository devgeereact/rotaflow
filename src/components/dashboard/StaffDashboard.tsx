import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { LogIn, Megaphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/StatTile';
import { timeRange, timeAgo, hoursLabel } from '@/components/dashboard/dashboardFormat';
import type {
  DashboardOverview,
  MyWeekSummary,
  ShiftGroup,
} from '@/services/dashboardService';

export interface StaffDashboardProps {
  firstName: string | null;
  overview: DashboardOverview;
  myWeek: MyWeekSummary | null;
  myUpcoming: ShiftGroup[];
  leaveRemaining: number | null;
  holidayAllowance: number | null;
  /** Their own open/pending shift swaps. Lifted to a prop, like everything
   * else here, so this stays a pure view driven by `DashboardPage`'s data,
   * not a second place that queries Supabase. */
  openSwaps: number;
}

/**
 * A staff member's home screen (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.dashboard` staff branch): their own hours and shifts, not the
 * org's numbers. `navItemsForRole`/`RequireRole` already keep a staff member
 * out of manager-only screens; this is the same principle applied to the one
 * screen every role lands on.
 */
export function StaffDashboard({
  firstName,
  overview,
  myWeek,
  myUpcoming,
  leaveRemaining,
  holidayAllowance,
  openSwaps,
}: StaffDashboardProps): JSX.Element {
  const timezone = overview.locations[0]?.timezone ?? 'Europe/London';

  return (
    <div className="max-w-[1600px]">
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <div>
          <h1 className="font-display text-page-title font-semibold text-content dark:text-content-dark">
            Good morning{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-content-muted dark:text-content-muted-dark">
            {format(new Date(), 'EEEE d MMMM')}
          </p>
        </div>
        <div className="ml-auto">
          <Link
            to="/app/clock"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-clock px-5 font-semibold text-white transition-transform duration-150 ease-in-out hover:scale-[1.02] active:scale-[0.98]"
          >
            <LogIn size={16} aria-hidden="true" />
            Clock in
          </Link>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Your hours this week"
          value={myWeek ? hoursLabel(myWeek.hours) : '—'}
        />
        <StatTile
          label="Shifts booked"
          value={myWeek?.shiftsBooked ?? 0}
          to="/app/schedule"
        />
        <StatTile
          label="Leave remaining"
          value={leaveRemaining ?? '—'}
          suffix={holidayAllowance ? `/ ${holidayAllowance}` : undefined}
          hint="days"
          to="/app/leave"
        />
        <StatTile label="Open swaps" value={openSwaps} to="/app/swaps" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-content dark:text-content-dark">
              Your next shifts
            </h2>
            <Link
              to="/app/schedule"
              className="text-sm font-medium text-primary-ink hover:underline dark:text-primary"
            >
              Full schedule
            </Link>
          </div>
          {myUpcoming.length === 0 ? (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              Nothing booked in the next 7 days.
            </p>
          ) : (
            <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
              {myUpcoming.map((group) => {
                const [start, end] = timeRange(group.startsAt, group.endsAt, timezone);
                return (
                  <li
                    key={group.key}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span
                      className="h-9 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: group.colour }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-content dark:text-content-dark">
                        {group.shiftTypeName}
                      </p>
                      <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                        {format(new Date(group.startsAt), 'EEE d MMM')} · {start}, {end} ·{' '}
                        {group.locationName}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-content dark:text-content-dark">
              Announcements
            </h2>
            <Link
              to="/app/announcements"
              className="text-sm font-medium text-primary-ink hover:underline dark:text-primary"
            >
              All
            </Link>
          </div>
          {overview.announcements.length === 0 ? (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              No announcements yet.
            </p>
          ) : (
            <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
              {overview.announcements.slice(0, 3).map((a) => (
                <li key={a.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  <span
                    className={cn(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-full',
                      a.urgent
                        ? 'bg-danger-wash text-danger dark:bg-danger-wash-dark'
                        : 'bg-primary-wash text-primary-ink dark:bg-primary-wash-dark dark:text-primary',
                    )}
                  >
                    <Megaphone size={16} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-content dark:text-content-dark">
                      {a.title}
                    </p>
                    <p className="text-xs text-content-muted dark:text-content-muted-dark">
                      {timeAgo(a.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
