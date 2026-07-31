import {
  Briefcase,
  Building2,
  CalendarDays,
  ChevronRight,
  MapPin,
  TriangleAlert,
} from 'lucide-react';
import { ClockCardHeading } from '@/components/clockin/ClockCardHeading';

export interface CurrentShiftInfo {
  /** "Starts in 12 min" — the pill above the time. */
  countdownLabel: string;
  timeRange: string;
  dateLabel: string;
  locationName: string;
  areaName: string;
  roleName: string;
  shiftTypeName: string;
  breakRange: string;
  /** Rendered muted next to the break range, e.g. "(30 min)". */
  breakDuration: string;
  paidHours: string;
  reminderTitle: string;
  reminderBody: string;
}

interface CurrentShiftPaneProps {
  shift: CurrentShiftInfo;
  onViewReminder?: () => void;
}

function MetaRow({
  icon: Icon,
  label,
}: {
  icon: typeof Building2;
  label: string;
}): JSX.Element {
  return (
    <li className="flex items-center gap-3">
      <Icon
        size={18}
        aria-hidden="true"
        className="shrink-0 text-content-muted dark:text-content-muted-dark"
      />
      <span className="text-base text-content dark:text-content-dark">
        {label}
      </span>
    </li>
  );
}

function Detail({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <div>
      <p className="text-sm font-medium text-content dark:text-content-dark">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/** Left half of the clock-in hero card — what shift you are about to start. */
export function CurrentShiftPane({
  shift,
  onViewReminder,
}: CurrentShiftPaneProps): JSX.Element {
  return (
    <div className="flex h-full flex-col p-6">
      <ClockCardHeading icon={CalendarDays} title="Current Shift" />

      <div className="mt-6 flex gap-8">
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center rounded-lg bg-clock-tint px-2.5 py-1 text-xs font-semibold text-clock-fg dark:bg-clock/20 dark:text-clock-tint">
            {shift.countdownLabel}
          </span>

          <p className="mt-4 text-page-title font-bold tracking-tight text-content dark:text-content-dark">
            {shift.timeRange}
          </p>
          <p className="mt-1 text-base text-content dark:text-content-dark">
            {shift.dateLabel}
          </p>

          <ul className="mt-5 space-y-5 border-t border-divider pt-5 dark:border-divider-dark">
            <MetaRow icon={Building2} label={shift.locationName} />
            <MetaRow icon={MapPin} label={shift.areaName} />
            <MetaRow icon={Briefcase} label={shift.roleName} />
          </ul>
        </div>

        <div className="w-40 shrink-0 space-y-5 pt-1">
          <Detail label="Shift Type">
            <span className="inline-flex items-center rounded-lg bg-clock-tint px-2.5 py-1 text-xs font-semibold text-clock-fg dark:bg-clock/20 dark:text-clock-tint">
              {shift.shiftTypeName}
            </span>
          </Detail>
          <Detail label="Break">
            <p className="text-sm text-content dark:text-content-dark">
              {shift.breakRange}{' '}
              <span className="text-content-muted dark:text-content-muted-dark">
                {shift.breakDuration}
              </span>
            </p>
          </Detail>
          <Detail label="Paid Hours">
            <p className="text-sm text-content dark:text-content-dark">
              {shift.paidHours}
            </p>
          </Detail>
        </div>
      </div>

      <div className="mt-auto border-t border-divider pt-6 dark:border-divider-dark">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
          <div className="flex items-start gap-3">
            <TriangleAlert
              size={18}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-warning"
            />
            <div>
              <p className="text-base font-semibold text-content dark:text-content-dark">
                {shift.reminderTitle}
              </p>
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                {shift.reminderBody}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onViewReminder}
            className="inline-flex shrink-0 items-center gap-1 rounded text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            View Details
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
