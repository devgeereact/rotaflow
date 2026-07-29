import { Fragment } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { shiftCellKey } from '@/lib/rotaGrid';
import { ScheduleShiftChip } from '@/components/schedule/ScheduleShiftChip';
import type { Location, Shift, ShiftType, StaffProfile } from '@/types';

export interface ScheduleGroup {
  location: Location | null;
  staff: StaffProfile[];
}

interface ScheduleGridProps {
  dates: string[];
  groups: ScheduleGroup[];
  shiftMap: Map<string, Shift[]>;
  shiftTypes: ShiftType[];
  timezone: string;
}

function isWeekend(dateIso: string): boolean {
  const day = new Date(`${dateIso}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

/**
 * Read-only staff × date grid for the published schedule, grouped by location.
 *
 * Staff are grouped by where they are actually rostered in this period, not by
 * a home location — `staff_profiles` has no location column, so anything else
 * would be invented. Someone working two sites appears under both.
 */
export function ScheduleGrid({
  dates,
  groups,
  shiftMap,
  shiftTypes,
  timezone,
}: ScheduleGridProps): JSX.Element {
  const typeById = new Map(shiftTypes.map((t) => [t.id, t]));
  const today = format(new Date(), 'yyyy-MM-dd');

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 min-w-[12rem] bg-surface p-3 text-left text-xs font-medium uppercase tracking-wide text-content-muted dark:bg-surface-dark dark:text-content-muted-dark"
            >
              Staff
            </th>
            {dates.map((date) => {
              const d = new Date(`${date}T00:00:00`);
              return (
                <th
                  key={date}
                  scope="col"
                  className={cn(
                    'min-w-[7.5rem] border-l border-surface-border p-3 text-center dark:border-surface-border-dark',
                    isWeekend(date) && 'bg-background/60 dark:bg-background-dark/60',
                  )}
                >
                  <span
                    className={cn(
                      'block text-xs font-medium',
                      date === today
                        ? 'text-primary'
                        : 'text-content dark:text-content-dark',
                    )}
                  >
                    {format(d, 'EEE d MMM')}
                  </span>
                  {date === today && (
                    <span className="text-[0.65rem] font-medium uppercase tracking-wide text-primary">
                      Today
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {groups.map((group) => (
            <Fragment key={group.location?.id ?? 'unassigned'}>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={dates.length + 1}
                  className="sticky left-0 bg-background px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-content-muted dark:bg-background-dark dark:text-content-muted-dark"
                >
                  {group.location?.name ?? 'No location'} · {group.staff.length}{' '}
                  {group.staff.length === 1 ? 'person' : 'people'}
                </th>
              </tr>

              {group.staff.map((person) => (
                <tr
                  key={`${group.location?.id ?? 'none'}:${person.id}`}
                  className="border-t border-surface-border dark:border-surface-border-dark"
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-surface p-3 text-left font-normal dark:bg-surface-dark"
                  >
                    <span className="block text-sm font-medium text-content dark:text-content-dark">
                      {person.first_name} {person.last_name}
                    </span>
                    {person.job_title && (
                      <span className="block text-xs text-content-muted dark:text-content-muted-dark">
                        {person.job_title}
                      </span>
                    )}
                  </th>

                  {dates.map((date) => {
                    const cellShifts = (
                      shiftMap.get(shiftCellKey(person.id, date)) ?? []
                    ).filter(
                      (s) => (s.location_id ?? null) === (group.location?.id ?? null),
                    );

                    return (
                      <td
                        key={date}
                        className={cn(
                          'border-l border-surface-border p-2 align-top dark:border-surface-border-dark',
                          isWeekend(date) &&
                            'bg-background/60 dark:bg-background-dark/60',
                        )}
                      >
                        {cellShifts.length === 0 ? (
                          <span
                            className="block text-center text-content-muted/60 dark:text-content-muted-dark/60"
                            aria-label="No shift"
                          >
                            –
                          </span>
                        ) : (
                          <div className="space-y-1">
                            {cellShifts.map((shift) => (
                              <ScheduleShiftChip
                                key={shift.id}
                                shift={shift}
                                shiftType={
                                  shift.shift_type_id
                                    ? typeById.get(shift.shift_type_id)
                                    : undefined
                                }
                                timezone={timezone}
                              />
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
