import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  AlertTriangle,
  CalendarDays,
  CircleCheck,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Callout } from '@/components/ui/Callout';
import { Card, Panel } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/StatTile';
import { PanelTabs } from '@/components/ui/PanelTabs';
import { AttendanceTable } from '@/components/attendance/AttendanceTable';
import { AttendanceStatusBadge } from '@/components/attendance/AttendanceStatusBadge';
import { hoursLabel } from '@/components/dashboard/dashboardFormat';
import { ATTENDANCE_STATUS_META, type AttendanceCounts } from '@/lib/attendance';
import { ATTENDANCE_SORTS, type AttendanceViewRow } from '@/lib/attendanceRows';
import type { PendingRequest, WeeklyRosterSummary } from '@/services/dashboardService';
import type { Location } from '@/types';

/**
 * Which of the two days the staffing table is showing.
 *
 * Both are loaded, and both are one click away rather than one behind a date
 * picker: "who is on tomorrow" is the second question every shift manager
 * asks and it should not need navigating to.
 */
export type StaffingDay = 'today' | 'tomorrow';

export interface OperationsDaySnapshot {
  date: string;
  rows: AttendanceViewRow[];
  counts: AttendanceCounts;
  /** Set when this day's read failed, so its tiles show "—" rather than 0. */
  failed: boolean;
}

export interface OperationsDashboardProps {
  orgName: string;
  /** Which sites are in scope. `null` for all of them. */
  locations: Location[];
  selectedLocationId: string | null;
  onSelectLocation: (locationId: string | null) => void;
  /** The clock the dates are stated in, and whether sites disagree. */
  timezone: string;
  mixedTimezones: boolean;
  today: OperationsDaySnapshot;
  tomorrow: OperationsDaySnapshot;
  staffingDay: StaffingDay;
  onStaffingDayChange: (day: StaffingDay) => void;
  pending: PendingRequest[];
  weekly: WeeklyRosterSummary | null;
  /** ISO instant of the last successful read, or null if there has not been one. */
  fetchedAt: string | null;
  /** True while a refresh is in flight. */
  refreshing: boolean;
  /** True when the live subscription is not currently connected. */
  stale: boolean;
  onRefresh: () => void;
  sort: string;
  direction: 'asc' | 'desc';
  onSort: (id: string, direction: 'asc' | 'desc') => void;
  onOpenRow: (row: AttendanceViewRow) => void;
}

/** A tile whose day failed to load shows "—", never a reassuring zero. */
function tileValue(failed: boolean, value: number): string | number {
  return failed ? '—' : value;
}

/**
 * The link a tile drills into, carrying the same predicates the tile counted.
 *
 * A count and its list must be the same query or the tile is decoration. The
 * status ids here are the same strings `attendance.ts` produces and
 * `AttendancePage` parses out of the URL, so a tile reading 3 opens a table of
 * exactly those three.
 */
function attendanceLink(
  date: string,
  locationId: string | null,
  statuses: readonly string[],
): string {
  const params = new URLSearchParams();
  params.set('from', date);
  params.set('to', date);
  if (locationId) params.append('loc', locationId);
  for (const status of statuses) params.append('status', status);
  return `/app/attendance?${params.toString()}`;
}

/**
 * The owner's operations screen.
 *
 * ## What it replaces, and why the numbers moved
 *
 * `ManagerDashboard` answered a planning question — this week's rostered
 * hours, cover against the minimum, the rota's publish state — and labelled
 * one of its tiles "On shift now". That tile counted **assigned shifts on
 * today's date, drafts included**. It did not fall to zero when people went
 * home, it counted somebody rostered from 18:00 from midnight onwards, and it
 * counted a shift on an unpublished draft nobody had been told about.
 *
 * Everything above the fold here is derived from `clock_events` instead, and
 * every tile states its own definition and drills through to the rows behind
 * it. The weekly chart and the publication state are kept — they are still
 * the right answer to a different question — and moved below today's
 * decisions.
 *
 * ## Two counts, named separately
 *
 * "Scheduled people" and "Scheduled shifts" are both shown. A person with two
 * shifts is one person and two shifts, and cover is a question about people
 * while workload is a question about shifts. Collapsing them is how a board
 * reports six people on a day that has four.
 *
 * ## What it refuses to say
 *
 * Nothing here calls anybody absent. A clock-in queued on a phone with no
 * signal has not reached the server and cannot be seen from here, so the
 * status is "Not recorded" and the tile that counts it says so. A failed read
 * shows "—", not 0: a dash is a question, a zero is a claim.
 */
export function OperationsDashboard({
  orgName,
  locations,
  selectedLocationId,
  onSelectLocation,
  timezone,
  mixedTimezones,
  today,
  tomorrow,
  staffingDay,
  onStaffingDayChange,
  pending,
  weekly,
  fetchedAt,
  refreshing,
  stale,
  onRefresh,
  sort,
  direction,
  onSort,
  onOpenRow,
}: OperationsDashboardProps): JSX.Element {
  const day = staffingDay === 'today' ? today : tomorrow;
  const issues = today.rows
    .filter((row) => row.issue !== null)
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 6);
  const tomorrowUncovered = tomorrow.counts.openShifts;
  const maxCover = Math.max(1, ...(weekly?.coverByDate.map((d) => d.onShift + 3) ?? [1]));

  return (
    <div className="max-w-[1600px]">
      {/* 1 — scope. Organisation, sites, the operational date and the clock
          it is stated in, and how fresh the numbers are. Every one of these
          was previously implicit, and one of them (`Europe/London`) was
          hard-coded. */}
      <header className="mb-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-page-title font-semibold text-content dark:text-content-dark">
              Operations
            </h1>
            <p className="text-content-muted dark:text-content-muted-dark">
              {orgName} · {format(new Date(`${today.date}T00:00:00`), 'EEEE d MMMM yyyy')}{' '}
              · {timezone}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="text-sm">
              <span className="sr-only">Location</span>
              <select
                value={selectedLocationId ?? ''}
                onChange={(event) => onSelectLocation(event.target.value || null)}
                className="h-11 rounded-xl border border-surface-border bg-surface px-3 text-sm text-content dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
              >
                <option value="">All locations</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-surface-border bg-surface px-4 text-sm font-medium text-content hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
            >
              <RefreshCw
                size={15}
                aria-hidden="true"
                className={cn(refreshing && 'motion-safe:animate-spin')}
              />
              Refresh
            </button>
            <Link
              to="/app/rota"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-fg hover:bg-primary/90"
            >
              <CalendarDays size={16} aria-hidden="true" />
              Rota builder
            </Link>
          </div>
        </div>

        <p
          aria-live="polite"
          className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-content-muted dark:text-content-muted-dark"
        >
          <span>
            {fetchedAt
              ? `Updated ${format(new Date(fetchedAt), 'HH:mm:ss')}`
              : 'Not yet loaded'}
          </span>
          {stale && (
            <span className="inline-flex items-center gap-1 text-warning-ink dark:text-warning-ink-dark">
              <WifiOff size={12} aria-hidden="true" />
              Live updates disconnected — reconnecting. Figures may be behind.
            </span>
          )}
          {mixedTimezones && (
            <span>
              Sites here use more than one timezone. Dates are grouped in {timezone}; each
              row shows its own site&rsquo;s times.
            </span>
          )}
          <span>
            Attendance is what has reached the server. A clock-in queued offline is not
            visible here until it syncs.
          </span>
        </p>
      </header>

      {/* 2 — the operational counts. */}
      <div className="mb-6 grid min-w-0 grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-8">
        <StatTile
          compact
          className="min-w-0"
          label="Scheduled today"
          value={tileValue(today.failed, today.counts.scheduledPeople)}
          // Both numbers, because they are different questions: cover is
          // about people, workload is about shifts. Somebody with two shifts
          // today is one scheduled person and two scheduled shifts.
          hint={`people · ${today.counts.scheduledShifts} shift${today.counts.scheduledShifts === 1 ? '' : 's'}`}
          to={attendanceLink(today.date, selectedLocationId, [])}
        />
        <StatTile
          compact
          className="min-w-0"
          label="Clocked in now"
          value={tileValue(today.failed, today.counts.workingNow)}
          hint={ATTENDANCE_STATUS_META.working.definition}
          to={attendanceLink(today.date, selectedLocationId, ['working'])}
        />
        <StatTile
          compact
          className="min-w-0"
          label="On break"
          value={tileValue(today.failed, today.counts.onBreak)}
          hint={ATTENDANCE_STATUS_META.on_break.definition}
          to={attendanceLink(today.date, selectedLocationId, ['on_break'])}
        />
        <StatTile
          compact
          className="min-w-0"
          label="Late start"
          value={tileValue(today.failed, today.counts.late)}
          hint={ATTENDANCE_STATUS_META.late.definition}
          to={attendanceLink(today.date, selectedLocationId, ['late'])}
        />
        <StatTile
          compact
          className="min-w-0"
          label="Completed"
          value={tileValue(today.failed, today.counts.completed)}
          hint={ATTENDANCE_STATUS_META.completed.definition}
          to={attendanceLink(today.date, selectedLocationId, ['completed'])}
        />
        <StatTile
          compact
          className="min-w-0"
          label="Open shifts"
          value={tileValue(today.failed, today.counts.openShifts)}
          hint="rostered today with nobody assigned"
          to="/app/open-shifts"
        />
        <StatTile
          compact
          className="min-w-0"
          label="Pending approvals"
          value={pending.length}
          hint="leave, swaps and missed clock-ins"
          to="/app/approvals"
        />
        <StatTile
          compact
          className="min-w-0"
          label="Tomorrow uncovered"
          value={tileValue(tomorrow.failed, tomorrowUncovered)}
          hint="shifts tomorrow with nobody assigned"
          to={attendanceLink(tomorrow.date, selectedLocationId, [])}
        />
      </div>

      {/* 4 — what needs a decision, before the charts. */}
      {issues.length > 0 && (
        <Callout
          tone="warning"
          className="mb-6"
          title={`${issues.length} thing${issues.length === 1 ? '' : 's'} on today's shift need${issues.length === 1 ? 's' : ''} a look`}
        >
          <ul className="mt-1 space-y-1.5">
            {issues.map((row) => (
              <li key={row.key} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <AttendanceStatusBadge status={row.status} />
                <span className="font-medium">{row.name}</span>
                {/* Inherits the Callout's own ink rather than the page's
                    muted grey: `text-content-muted` on the warning wash
                    measures 4.34:1, just under the 4.5:1 body text needs. */}
                <span className="opacity-80">
                  {[row.locationName, row.plannedLabel].filter(Boolean).join(' · ')}
                </span>
                <span>{row.issue}</span>
                <Link
                  to={attendanceLink(today.date, row.locationId, [row.status])}
                  className="font-medium text-primary-ink hover:underline dark:text-primary-ink-dark"
                >
                  Open
                  <span className="sr-only"> {row.name}&rsquo;s attendance</span>
                </Link>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {/* 3 — today and tomorrow, both one click away. */}
      <Panel
        title="Staffing"
        actions={
          <div className="flex items-center gap-3">
            <PanelTabs<StaffingDay>
              label="Staffing day"
              gapClass="gap-6"
              items={[
                {
                  value: 'today',
                  label: `Today · ${format(new Date(`${today.date}T00:00:00`), 'd MMM')}`,
                },
                {
                  value: 'tomorrow',
                  label: `Tomorrow · ${format(new Date(`${tomorrow.date}T00:00:00`), 'd MMM')}`,
                },
              ]}
              active={staffingDay}
              onChange={onStaffingDayChange}
            />
            <Link
              to={attendanceLink(day.date, selectedLocationId, [])}
              className="text-sm font-medium text-primary-ink hover:underline dark:text-primary-ink-dark"
            >
              Open in attendance
            </Link>
          </div>
        }
        className="mb-6"
      >
        {day.failed ? (
          <p className="py-6 text-center text-sm text-content-muted dark:text-content-muted-dark">
            This day could not be read. Nothing is known either way until it loads.
          </p>
        ) : day.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-content-muted dark:text-content-muted-dark">
            Nobody is rostered on a published rota for this day.
          </p>
        ) : (
          <AttendanceTable
            rows={day.rows}
            sorts={ATTENDANCE_SORTS}
            sort={sort}
            direction={direction}
            onSort={onSort}
            onOpen={onOpenRow}
            mixedTimezoneNote={null}
          />
        )}
      </Panel>

      {/* 5 — the week. Secondary, and labelled as planning rather than
          operations, because it is deliberately draft-inclusive. */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-content dark:text-content-dark">
              Cover against minimum, this week
            </h2>
            <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-xs text-content-muted dark:bg-surface-subtle-dark dark:text-content-muted-dark">
              Planning view · drafts included
            </span>
          </div>
          <p className="mb-4 text-xs text-content-muted dark:text-content-muted-dark">
            This chart counts rostered people, published or not, because a manager builds
            towards the minimum before publishing. It is not an attendance figure and
            never matches the tiles above.
          </p>
          <div className="grid h-[200px] grid-cols-7 gap-2">
            {(weekly?.coverByDate ?? []).map((entry) => {
              const short = entry.onShift < entry.required;
              return (
                <div
                  key={entry.date}
                  className="flex h-full flex-col items-center gap-1.5"
                >
                  <div className="relative flex w-full flex-1 items-end border-b border-surface-border dark:border-surface-border-dark">
                    <span
                      className="absolute left-0 right-0 border-t border-dashed border-warning"
                      style={{
                        bottom: `${Math.min(100, (entry.required / maxCover) * 100)}%`,
                      }}
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        'w-full rounded-t-lg',
                        short ? 'bg-danger' : 'bg-primary',
                      )}
                      style={{
                        height: `${Math.min(100, (entry.onShift / maxCover) * 100)}%`,
                      }}
                    />
                  </div>
                  <span
                    className={cn(
                      'font-mono text-xs font-semibold',
                      short
                        ? 'text-danger-ink dark:text-danger-ink-dark'
                        : 'text-content dark:text-content-dark',
                    )}
                  >
                    {entry.onShift}
                  </span>
                  <span className="text-[11px] text-content-muted dark:text-content-muted-dark">
                    {format(new Date(`${entry.date}T00:00:00`), 'EEE')}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="grid gap-6">
          <Card className="p-5">
            <h2 className="mb-1 font-semibold text-content dark:text-content-dark">
              Rota publication
            </h2>
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              {weekly?.rotaStatus === 'published'
                ? 'This week is published and visible to staff.'
                : weekly?.rotaStatus === 'draft'
                  ? 'This week is still a draft. Staff cannot see it, and the attendance figures above only count published shifts.'
                  : 'No rota exists for this week yet.'}
            </p>
            <p className="mt-2 text-sm">
              <Link
                to="/app/rota"
                className="font-medium text-primary-ink hover:underline dark:text-primary-ink-dark"
              >
                Open the rota builder
              </Link>
            </p>
            {weekly && (
              <p className="mt-3 text-sm text-content-muted dark:text-content-muted-dark">
                {hoursLabel(weekly.totalHours)} rostered this week.
              </p>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-semibold text-content dark:text-content-dark">
              Waiting on a decision
            </h2>
            {pending.length === 0 ? (
              <p className="flex items-start gap-2 text-sm text-content-muted dark:text-content-muted-dark">
                <CircleCheck
                  size={16}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-success"
                />
                Nothing is waiting on you.
              </p>
            ) : (
              <ul className="space-y-2">
                {pending.slice(0, 5).map((request) => (
                  <li key={request.id} className="text-sm">
                    <span className="font-medium text-content dark:text-content-dark">
                      {request.staffName}
                    </span>{' '}
                    <span className="text-content-muted dark:text-content-muted-dark">
                      {request.detail} · {request.dateLabel}
                    </span>{' '}
                    <Link
                      to={
                        request.kind === 'leave'
                          ? '/app/leave'
                          : request.kind === 'swap'
                            ? '/app/swaps'
                            : `/app/attendance?from=${today.date}&to=${today.date}&status=not_recorded`
                      }
                      className="font-medium text-primary-ink hover:underline dark:text-primary-ink-dark"
                    >
                      Decide
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {pending.length > 5 && (
              <p className="mt-2 text-sm">
                <Link
                  to="/app/approvals"
                  className="font-medium text-primary-ink hover:underline dark:text-primary-ink-dark"
                >
                  {pending.length - 5} more in Approvals
                </Link>
              </p>
            )}
          </Card>

          {weekly && weekly.overLimitStaff.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-2 flex items-center gap-2 font-semibold text-content dark:text-content-dark">
                <AlertTriangle
                  size={16}
                  aria-hidden="true"
                  className="text-warning-ink dark:text-warning-ink-dark"
                />
                Hours to check
              </h2>
              <ul className="space-y-1 text-sm">
                {weekly.overLimitStaff.slice(0, 4).map((person) => (
                  <li key={person.staffName}>
                    <span className="font-medium text-content dark:text-content-dark">
                      {person.staffName}
                    </span>{' '}
                    <span className="text-content-muted dark:text-content-muted-dark">
                      {hoursLabel(person.hours)}{' '}
                      {person.overStatutory
                        ? 'rostered — over the 48-hour weekly limit'
                        : `rostered against a ${person.contractHours}h contract`}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
