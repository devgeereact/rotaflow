import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { pairClockEvents } from '@/lib/hours';
import { paletteTokenForColour } from '@/lib/shiftPalette';
import { cn } from '@/lib/utils';
import { timeRange } from '@/components/dashboard/dashboardFormat';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Panel } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/StatTile';
import type { WeeklyRosterSummary } from '@/services/dashboardService';
import type {
  ClockEvent,
  LeaveRequest,
  Location,
  Shift,
  ShiftType,
  StaffProfile,
} from '@/types';

export interface ManagerScheduleProps {
  todayLabel: string;
  weekly: WeeklyRosterSummary | null;
  /** Today's shifts, draft-inclusive: a manager needs the operational
   * reality, not just what has been published. */
  shifts: Shift[];
  staff: StaffProfile[];
  locations: Location[];
  shiftTypes: ShiftType[];
  /** The org's leave requests, any status; filtered to today here. */
  leave: LeaveRequest[];
  /** Today's clock events, org-wide. */
  clockEvents: ClockEvent[];
}

interface SitePerson {
  shiftId: string;
  name: string;
  colour: string | null;
  typeName: string;
  timeLabel: string;
}

interface SiteGroup {
  locationId: string;
  locationName: string;
  people: SitePerson[];
}

/** `docs/ORGANISATION_WORKSPACE.html`'s per-site "who's on" list. Grouped by
 * the shift's own location, not a staff→site mapping: `staff_profiles` has no
 * location column (see the note in RotaBuilderPage), so a shift's `location_id`
 * is the only honest source for "which site". Only assigned, located shifts
 * can appear here; an open slot has nobody to list. */
function groupBySite(
  shifts: Shift[],
  staff: StaffProfile[],
  locations: Location[],
  shiftTypes: ShiftType[],
): SiteGroup[] {
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const typeById = new Map(shiftTypes.map((t) => [t.id, t]));

  const byLocation = new Map<string, SitePerson[]>();
  for (const shift of shifts) {
    if (!shift.staff_profile_id || !shift.location_id) continue;
    const person = staffById.get(shift.staff_profile_id);
    const location = locationById.get(shift.location_id);
    if (!person || !location) continue;
    const type = shift.shift_type_id ? typeById.get(shift.shift_type_id) : undefined;
    const [start, end] = timeRange(shift.starts_at, shift.ends_at, location.timezone);

    const list = byLocation.get(location.id) ?? [];
    list.push({
      shiftId: shift.id,
      name: `${person.first_name} ${person.last_name}`,
      colour: shift.colour ?? type?.colour ?? null,
      typeName: type?.name ?? 'Shift',
      timeLabel: `${start}, ${end}`,
    });
    byLocation.set(location.id, list);
  }

  return [...byLocation.entries()]
    .map(([locationId, people]) => ({
      locationId,
      locationName: locationById.get(locationId)?.name ?? 'Unknown location',
      people: people.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.locationName.localeCompare(b.locationName));
}

/** Who currently has an open clock-in segment, and who is scheduled today but
 * has not yet started one. */
function clockStatus(
  shifts: Shift[],
  clockEvents: ClockEvent[],
): { clockedIn: number; notYetClockedIn: number } {
  const scheduled = new Set(
    shifts.map((s) => s.staff_profile_id).filter((id): id is string => id !== null),
  );

  const eventsByStaff = new Map<string, ClockEvent[]>();
  for (const event of clockEvents) {
    const list = eventsByStaff.get(event.staff_profile_id) ?? [];
    list.push(event);
    eventsByStaff.set(event.staff_profile_id, list);
  }

  const clockedInIds = new Set<string>();
  for (const [staffId, events] of eventsByStaff) {
    const segments = pairClockEvents(events);
    const last = segments[segments.length - 1];
    if (last && last.clockOut === null) clockedInIds.add(staffId);
  }

  const notYetClockedIn = [...scheduled].filter((id) => !clockedInIds.has(id)).length;
  return { clockedIn: clockedInIds.size, notYetClockedIn };
}

/**
 * The manager's Schedule (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.schedule` manager branch): who is on, where, right now. Distinct
 * from the Rota Builder, which is where that reality gets changed. "Week" is
 * deliberately inert here (a toast points at the builder), matching the
 * reference: this screen answers "who's on today", not "what does the whole
 * rota look like".
 *
 * No "Agency cover" tile: the reference's is a fabricated headcount with no
 * table behind it in this schema, and inventing one would be worse than
 * leaving it out (the same call `ManagerDashboard` makes for "Next
 * auto-publish").
 */
export function ManagerSchedule({
  todayLabel,
  weekly,
  shifts,
  staff,
  locations,
  shiftTypes,
  leave,
  clockEvents,
}: ManagerScheduleProps): JSX.Element {
  const { showToast } = useToast();
  const today = format(new Date(), 'yyyy-MM-dd');

  const onShiftNow = new Set(
    shifts.map((s) => s.staff_profile_id).filter((id): id is string => id !== null),
  ).size;
  const requiredToday = weekly?.coverByDate.find((d) => d.date === today)?.required ?? 0;

  const { clockedIn, notYetClockedIn } = clockStatus(shifts, clockEvents);

  const onLeaveToday = leave.filter(
    (l) =>
      l.status === 'approved' &&
      l.type === 'annual' &&
      l.start_date <= today &&
      l.end_date >= today,
  ).length;
  const offSickToday = leave.filter(
    (l) =>
      l.status === 'approved' &&
      l.type === 'sick' &&
      l.start_date <= today &&
      l.end_date >= today,
  ).length;

  const groups = groupBySite(shifts, staff, locations, shiftTypes);

  return (
    <div>
      <WorkspaceHeader
        title="Schedule"
        subtitle="Who is on, where, right now. The rota builder is where you change it."
        actions={
          <>
            <div
              role="group"
              aria-label="View"
              className="flex rounded-xl border border-surface-border p-1 dark:border-surface-border-dark"
            >
              <button
                type="button"
                aria-pressed="true"
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg"
              >
                Day
              </button>
              <button
                type="button"
                aria-pressed="false"
                onClick={() =>
                  showToast('info', 'Week view is the rota builder grid, read-only here.')
                }
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-content-muted hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark"
              >
                Week
              </button>
            </div>
            <Link
              to="/app/rota"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-surface-border bg-surface px-5 font-semibold text-content transition-transform duration-150 ease-in-out hover:scale-[1.02] hover:bg-surface-subtle active:scale-[0.98] dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
            >
              <CalendarDays size={16} aria-hidden="true" />
              Edit in rota builder
            </Link>
          </>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="On shift now"
          value={onShiftNow}
          hint={`of ${requiredToday} required`}
        />
        <StatTile
          label="Clocked in"
          value={clockedIn}
          hint={
            notYetClockedIn > 0 ? (
              <span className="text-danger-ink dark:text-danger-ink-dark">
                {notYetClockedIn} not yet
              </span>
            ) : undefined
          }
          to="/app/timesheets"
        />
        <StatTile label="On leave" value={onLeaveToday} />
        <StatTile label="Off sick" value={offSickToday} />
        <StatTile
          label="Status"
          value={weekly?.rotaStatus === 'published' ? 'Published' : 'Draft'}
          hint={
            weekly?.rotaStatus === 'published' ? (
              <span className="text-success">staff notified</span>
            ) : (
              <span className="text-danger-ink dark:text-danger-ink-dark">
                not visible to staff
              </span>
            )
          }
        />
      </div>

      <Panel
        title={todayLabel}
        actions={
          <span className="text-xs text-content-muted dark:text-content-muted-dark">
            Grouped by site
          </span>
        }
        flush
      >
        {groups.length === 0 ? (
          <p className="p-6 text-center text-sm text-content-muted dark:text-content-muted-dark">
            No one is rostered today.
          </p>
        ) : (
          <div className="divide-y divide-surface-border dark:divide-surface-border-dark">
            {groups.map((group) => (
              <div key={group.locationId} className="p-4">
                <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-content-muted dark:text-content-muted-dark">
                  {group.locationName} &middot; {group.people.length} on
                </p>
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {group.people.map((person) => (
                    <div
                      key={person.shiftId}
                      className="flex items-center gap-2.5 rounded-xl border border-surface-border p-2.5 dark:border-surface-border-dark"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'h-8 w-1 shrink-0 rounded-full',
                          paletteTokenForColour(person.colour),
                        )}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-content dark:text-content-dark">
                          {person.name}
                        </p>
                        <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                          {person.typeName} &middot; {person.timeLabel}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
