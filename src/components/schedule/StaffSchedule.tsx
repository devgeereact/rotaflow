import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { CalendarClock, CalendarPlus, Repeat2 } from 'lucide-react';
import { fromIsoInTimezone } from '@/lib/rotaGrid';
import { shiftNetMinutes } from '@/lib/rotaInsights';
import { paletteTokenForColour } from '@/lib/shiftPalette';
import { cn } from '@/lib/utils';
import { hoursLabel } from '@/components/dashboard/dashboardFormat';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import type { Location, Shift, ShiftType } from '@/types';

export interface StaffScheduleProps {
  /** e.g. "4 August 2026", the Monday of the week shown. */
  weekStartLabel: string;
  weekDates: string[];
  published: boolean;
  shifts: Shift[];
  locations: Location[];
  shiftTypes: ShiftType[];
  /** Used for a shift whose own location cannot be resolved. */
  fallbackTimezone: string;
  onAddToCalendar: () => void;
  /**
   * Subscribe rather than download (CAP-063). Optional: a person with no
   * staff record in this organisation has no shifts to subscribe to, and the
   * button is absent rather than present and failing.
   */
  onSubscribe?: () => void;
}

interface DayShift {
  id: string;
  colour: string | null;
  typeName: string;
  timeLabel: string;
  locationName: string;
  hours: string;
}

interface DaySchedule {
  date: string;
  weekdayLabel: string;
  dayNumber: string;
  isToday: boolean;
  shifts: DayShift[];
}

function buildDays(
  dates: string[],
  shifts: Shift[],
  locations: Location[],
  shiftTypes: ShiftType[],
  fallbackTimezone: string,
): DaySchedule[] {
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const typeById = new Map(shiftTypes.map((t) => [t.id, t]));
  const today = format(new Date(), 'yyyy-MM-dd');

  const byDate = new Map<string, DayShift[]>();
  for (const shift of shifts) {
    const location = shift.location_id ? locationById.get(shift.location_id) : undefined;
    const timezone = location?.timezone ?? fallbackTimezone;
    const { date, time: start } = fromIsoInTimezone(shift.starts_at, timezone);
    const { time: end } = fromIsoInTimezone(shift.ends_at, timezone);
    const type = shift.shift_type_id ? typeById.get(shift.shift_type_id) : undefined;

    const list = byDate.get(date) ?? [];
    list.push({
      id: shift.id,
      colour: shift.colour ?? type?.colour ?? null,
      typeName: type?.name ?? 'Shift',
      timeLabel: `${start}, ${end}`,
      locationName: location?.name ?? 'No location',
      hours: hoursLabel(shiftNetMinutes(shift) / 60),
    });
    byDate.set(date, list);
  }

  return dates.map((date) => {
    const d = new Date(`${date}T00:00:00`);
    return {
      date,
      weekdayLabel: format(d, 'EEE'),
      dayNumber: format(d, 'd'),
      isToday: date === today,
      shifts: (byDate.get(date) ?? []).sort((a, b) =>
        a.timeLabel.localeCompare(b.timeLabel),
      ),
    };
  });
}

const LINK_BUTTON =
  'inline-flex h-9 items-center gap-2 rounded-xl border border-surface-border bg-surface px-3 text-sm font-semibold text-content transition-transform duration-150 ease-in-out hover:scale-[1.02] hover:bg-surface-subtle active:scale-[0.98] dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark';

/**
 * A staff member's own Schedule (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.schedule` staff branch): the current week, one card per day.
 *
 * Published-only, like the rest of this screen for staff: a draft is the
 * manager's working copy, so an unpublished day never fabricates a
 * placeholder shift, it reads "Not scheduled" like any other empty day.
 */
export function StaffSchedule({
  weekStartLabel,
  weekDates,
  published,
  shifts,
  locations,
  shiftTypes,
  fallbackTimezone,
  onAddToCalendar,
  onSubscribe,
}: StaffScheduleProps): JSX.Element {
  const days = buildDays(weekDates, shifts, locations, shiftTypes, fallbackTimezone);

  return (
    <div>
      <WorkspaceHeader
        title="Your schedule"
        subtitle={`Week commencing ${weekStartLabel}${published ? '' : '. Your manager has not published this week yet'}.`}
        actions={
          <>
            <Link to="/app/swaps" className={LINK_BUTTON}>
              <Repeat2 size={15} aria-hidden="true" />
              Offer a swap
            </Link>
            {/* Download and subscribe are both here on purpose. A file is
                right for "send me this week"; it is wrong as a standing
                arrangement, because an amended rota leaves the phone showing
                last week's shifts with a reminder attached. */}
            <Button variant="secondary" onClick={onAddToCalendar}>
              <CalendarPlus size={16} aria-hidden="true" />
              Download this week
            </Button>
            {onSubscribe && (
              <Button variant="secondary" onClick={onSubscribe}>
                <CalendarClock size={16} aria-hidden="true" />
                Subscribe
              </Button>
            )}
          </>
        }
      />

      {!published && (
        <Callout tone="warning" className="mb-4">
          This week is still a draft. Check back once your manager publishes it.
        </Callout>
      )}

      <div className="space-y-2.5">
        {days.map((day) => (
          <Card
            key={day.date}
            className={cn(
              'flex flex-wrap items-center gap-3.5 p-3.5',
              day.isToday && 'ring-1 ring-primary/40',
            )}
          >
            <div className="min-w-[44px] text-center">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-content-muted dark:text-content-muted-dark">
                {day.weekdayLabel}
              </p>
              <p className="font-mono text-lg font-semibold text-content dark:text-content-dark">
                {day.dayNumber}
              </p>
            </div>

            {day.shifts.length === 0 ? (
              <>
                <p className="text-sm text-content-muted dark:text-content-muted-dark">
                  Not scheduled
                </p>
                <div className="ml-auto">
                  <Link to="/app/availability" className={LINK_BUTTON}>
                    Set availability
                  </Link>
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col gap-2.5">
                {day.shifts.map((shift) => (
                  <div key={shift.id} className="flex flex-wrap items-center gap-3.5">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'h-10 w-1 shrink-0 rounded-full',
                        paletteTokenForColour(shift.colour),
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-content dark:text-content-dark">
                        {shift.typeName}
                      </p>
                      <p className="text-xs text-content-muted dark:text-content-muted-dark">
                        {shift.timeLabel} &middot; {shift.locationName}
                      </p>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <span className="font-mono text-xs text-content-muted dark:text-content-muted-dark">
                        {shift.hours}
                      </span>
                      <Link to="/app/swaps" className={LINK_BUTTON}>
                        Swap
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
