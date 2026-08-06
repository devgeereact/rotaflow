import { format } from 'date-fns';
import { MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fromIsoInTimezone } from '@/lib/rotaGrid';
import { paletteTokenForColour } from '@/lib/shiftPalette';
import type { Location, Shift, ShiftType, StaffProfile } from '@/types';

interface ScheduleAgendaProps {
  dates: string[];
  shiftsByDate: Map<string, Shift[]>;
  shiftTypes: ShiftType[];
  locations: Location[];
  staff: StaffProfile[];
  timezone: string;
  /** Hide the person's name. True in "my schedule", where it is always you. */
  hideNames?: boolean;
}

/**
 * Date-grouped list of shifts.
 *
 * Used for the month view and for a staff member's own schedule. A 31-column
 * grid is unreadable on any screen, and a staff member on a phone wants "what
 * am I doing next", not a spreadsheet, so this is the primary staff view
 * rather than a fallback.
 *
 * Days with nothing scheduled are omitted rather than rendered empty: a month
 * of blank rows buries the handful of days that matter.
 */
export function ScheduleAgenda({
  dates,
  shiftsByDate,
  shiftTypes,
  locations,
  staff,
  timezone,
  hideNames = false,
}: ScheduleAgendaProps): JSX.Element {
  const typeById = new Map(shiftTypes.map((t) => [t.id, t]));
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const today = format(new Date(), 'yyyy-MM-dd');

  const populated = dates.filter((d) => (shiftsByDate.get(d)?.length ?? 0) > 0);

  if (populated.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-content-muted dark:text-content-muted-dark">
        No published shifts in this period.
      </p>
    );
  }

  return (
    <ol className="divide-y divide-surface-border dark:divide-surface-border-dark">
      {populated.map((date) => {
        const dayShifts = shiftsByDate.get(date) ?? [];
        const d = new Date(`${date}T00:00:00`);

        return (
          <li key={date} className="flex flex-col gap-3 p-4 sm:flex-row sm:gap-6">
            <div className="sm:w-32 sm:shrink-0">
              <p
                className={cn(
                  'text-sm font-semibold',
                  date === today ? 'text-primary' : 'text-content dark:text-content-dark',
                )}
              >
                {format(d, 'EEEE')}
              </p>
              <p className="text-xs text-content-muted dark:text-content-muted-dark">
                {format(d, 'd MMMM yyyy')}
                {date === today && ' · Today'}
              </p>
            </div>

            <ul className="flex-1 space-y-2">
              {dayShifts.map((shift) => {
                const type = shift.shift_type_id
                  ? typeById.get(shift.shift_type_id)
                  : undefined;
                const location = shift.location_id
                  ? locationById.get(shift.location_id)
                  : undefined;
                const person = shift.staff_profile_id
                  ? staffById.get(shift.staff_profile_id)
                  : undefined;
                const { time: start } = fromIsoInTimezone(shift.starts_at, timezone);
                const { time: end } = fromIsoInTimezone(shift.ends_at, timezone);

                return (
                  <li
                    key={shift.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-border p-3 dark:border-surface-border-dark"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'h-10 w-1.5 shrink-0 rounded-full',
                        paletteTokenForColour(type?.colour),
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium tabular-nums text-content dark:text-content-dark">
                        {start}, {end}
                        {type?.name && (
                          <span className="ml-2 font-normal text-content-muted dark:text-content-muted-dark">
                            {type.name}
                          </span>
                        )}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-3 text-xs text-content-muted dark:text-content-muted-dark">
                        {!hideNames && person && (
                          <span>
                            {person.first_name} {person.last_name}
                          </span>
                        )}
                        {location && (
                          <span className="flex items-center gap-1">
                            <MapPin size={11} aria-hidden="true" />
                            {location.name}
                          </span>
                        )}
                        {shift.break_minutes > 0 && (
                          <span>{shift.break_minutes} min break</span>
                        )}
                      </p>
                      {shift.notes && (
                        <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
                          {shift.notes}
                        </p>
                      )}
                    </div>

                    {shift.status === 'open' && (
                      <span className="rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
                        Unfilled
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
