import {
  Briefcase,
  Building2,
  CalendarDays,
  ChevronRight,
  MapPin,
  TriangleAlert,
} from 'lucide-react';
import { ClockCardHeading } from '@/components/clockin/ClockCardHeading';
import type { CurrentShiftInfo } from '@/lib/clockRows';

interface CurrentShiftPaneProps {
  /** `null` when nothing is rostered today. The reference never shows this. */
  shift: CurrentShiftInfo | null;
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
      <span className="text-base text-content dark:text-content-dark">{label}</span>
    </li>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div>
      <p className="text-sm font-medium text-content dark:text-content-dark">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/** Left half of the clock-in hero card. What shift you are about to start. */
export function CurrentShiftPane({
  shift,
  onViewReminder,
}: CurrentShiftPaneProps): JSX.Element {
  if (!shift) {
    return (
      <div className="flex h-full flex-col p-6">
        <ClockCardHeading icon={CalendarDays} title="Current Shift" />
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-surface-subtle text-content-muted dark:bg-surface-subtle-dark dark:text-content-muted-dark">
            <CalendarDays size={24} aria-hidden="true" />
          </span>
          <p className="mt-4 text-base font-semibold text-content dark:text-content-dark">
            No shift scheduled today
          </p>
          <p className="mt-1 max-w-xs text-sm text-content-muted dark:text-content-muted-dark">
            You can still clock in if you have been asked to cover. It will be recorded
            against your location.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-6">
      <ClockCardHeading icon={CalendarDays} title="Current Shift" />

      {/* Stacked on a phone. Side by side, the fixed 160px detail column left
          the time range about 100px to live in, so "09:00–17:00" broke across
          two lines and the site name wrapped a word at a time. */}
      <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:gap-8">
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center rounded-lg bg-clock-tint px-2.5 py-1 text-xs font-semibold text-clock-fg dark:bg-clock/20 dark:text-clock-tint">
            {shift.countdownLabel}
          </span>

          <p className="mt-4 text-3xl font-bold tracking-tight tabular-nums text-content sm:text-4xl dark:text-content-dark">
            {shift.timeRange}
          </p>
          <p className="mt-1 text-base text-content dark:text-content-dark">
            {shift.dateLabel}
          </p>

          <ul className="mt-5 space-y-4 border-t border-divider pt-5 dark:border-divider-dark">
            <MetaRow icon={Building2} label={shift.locationName} />
            {shift.areaName && <MetaRow icon={MapPin} label={shift.areaName} />}
            {shift.roleName && <MetaRow icon={Briefcase} label={shift.roleName} />}
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:block sm:w-40 sm:shrink-0 sm:space-y-5 sm:pt-1">
          {shift.shiftTypeName && (
            <Detail label="Shift Type">
              <span className="inline-flex items-center rounded-lg bg-clock-tint px-2.5 py-1 text-xs font-semibold text-clock-fg dark:bg-clock/20 dark:text-clock-tint">
                {shift.shiftTypeName}
              </span>
            </Detail>
          )}
          <Detail label="Break">
            <p className="text-sm text-content dark:text-content-dark">
              {shift.breakRange ?? 'None'}{' '}
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

      {shift.reminder && (
        <div className="mt-auto border-t border-divider pt-6 dark:border-divider-dark">
          {/* The opaque wash token, not `warning/10`: an alpha of the solid
              hue lands on a different colour over a card than over the canvas,
              so the same reminder read as two shades. docs/DESIGN.md §2. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-wash px-4 py-3 dark:bg-warning-wash-dark">
            <div className="flex items-start gap-3">
              <TriangleAlert
                size={18}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-warning"
              />
              <div>
                <p className="text-base font-semibold text-content dark:text-content-dark">
                  {shift.reminder.title}
                </p>
                {/* `content`, not `content-muted`: on the warning tint this
                    line is 4.49 : 1 against a 4.5 : 1 minimum (GAP-030). One
                    hundredth under is still under. */}
                <p className="text-sm text-content dark:text-content-dark">
                  {shift.reminder.body}
                </p>
              </div>
            </div>
            {onViewReminder && (
              <button
                type="button"
                onClick={onViewReminder}
                className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-primary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-primary-ink-dark"
              >
                View Details
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
