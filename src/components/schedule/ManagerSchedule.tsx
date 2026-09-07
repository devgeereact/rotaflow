import { Link } from 'react-router-dom';
import { CalendarDays, ScanFace } from 'lucide-react';
import { ATTENDANCE_STATUS_META, type AttendanceCounts } from '@/lib/attendance';
import { paletteTokenForColour } from '@/lib/shiftPalette';
import { cn } from '@/lib/utils';
import { timeRange } from '@/components/dashboard/dashboardFormat';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Panel } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/StatTile';
import type { WeeklyRosterSummary } from '@/services/dashboardService';
import type { LeaveRequest, Location, Shift, ShiftType, StaffProfile } from '@/types';

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
  /**
   * Today's attendance, derived from `clock_events` by `lib/attendance.ts`.
   *
   * This screen used to pair the events itself and subtract "whoever has an
   * open segment" from "everyone rostered today", which produced two wrong
   * readings at once: somebody who finished at 14:00 counted as *not yet*
   * clocked in for the rest of the day, and somebody due to start at 18:00
   * counted the same way from midnight. Both now have their own state, and
   * the counts come from the same module the dashboard and the attendance
   * workspace use, so the three cannot disagree.
   */
  attendance: AttendanceCounts;
  /** The date these figures describe, in the reporting timezone. */
  operationalDate: string;
  /** Which clock the date is stated in, for the header. */
  timezone: string;
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

/**
 * The manager's Schedule (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.schedule` manager branch): who is on, where, right now. Distinct
 * from the Rota Builder, which is where that reality gets changed, and from
 * Team Attendance, which is where the record is reviewed and corrected.
 *
 * No "Agency cover" tile: the reference's is a fabricated headcount with no
 * table behind it in this schema, and inventing one would be worse than
 * leaving it out.
 */
export function ManagerSchedule({
  todayLabel,
  weekly,
  shifts,
  staff,
  locations,
  shiftTypes,
  leave,
  attendance,
  operationalDate,
  timezone,
}: ManagerScheduleProps): JSX.Element {
  // The date this screen is about, in the SITE's clock rather than the
  // browser's. `format(new Date())` here meant a manager covering a London
  // home from a laptop set to New York read yesterday's cover figure for five
  // hours every evening.
  const today = operationalDate;
  const requiredToday = weekly?.coverByDate.find((d) => d.date === today)?.required ?? 0;

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
            {/* The Day/Week pair is gone. "Week" was a button whose only
                effect was a toast saying week view lives in the rota builder,
                which is navigation described rather than performed. The rota
                builder is now a continuous three-week grid, so the link below
                goes to the thing the toast was talking about. */}
            <Link
              to="/app/attendance"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-surface-border bg-surface px-5 font-semibold text-content transition-transform duration-150 ease-in-out hover:scale-[1.02] hover:bg-surface-subtle active:scale-[0.98] dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
            >
              <ScanFace size={16} aria-hidden="true" />
              Attendance
            </Link>
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
          label="Scheduled today"
          value={attendance.scheduledPeople}
          hint={`people · of ${requiredToday} required`}
        />
        <StatTile
          label="Working now"
          value={attendance.workingNow}
          hint={
            attendance.late > 0 ? (
              <span className="text-warning-ink dark:text-warning-ink-dark">
                {attendance.late} late
              </span>
            ) : (
              ATTENDANCE_STATUS_META.working.definition
            )
          }
          to="/app/attendance"
        />
        <StatTile
          label="On break"
          value={attendance.onBreak}
          hint={ATTENDANCE_STATUS_META.on_break.definition}
          to="/app/attendance"
        />
        <StatTile
          label="On leave"
          value={onLeaveToday}
          hint={`${offSickToday} off sick`}
        />
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
            Grouped by site · times in {timezone}
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
