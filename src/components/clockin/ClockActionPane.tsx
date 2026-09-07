import type { ReactNode } from 'react';
import { Coffee, Fingerprint, LogOut, MapPinOff, Play, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import type { ClockStage } from '@/lib/clockRows';

interface StageCopy {
  heading: string;
  primaryLabel: string;
  primaryIcon: typeof Fingerprint;
  secondaryLabel: string;
  secondaryIcon: typeof Fingerprint;
}

/**
 * `ready` is the state docs/design/clockin.png shows. The other three are the same
 * pane once the shift is under way. The reference never illustrates them, so
 * only the labels and the ring tint change; every dimension is shared.
 */
const STAGES: Record<ClockStage, StageCopy> = {
  ready: {
    heading: 'Ready to Clock In?',
    primaryLabel: 'Clock In Now',
    primaryIcon: Fingerprint,
    secondaryLabel: 'Clock In Manually',
    secondaryIcon: MapPinOff,
  },
  working: {
    heading: "You're Clocked In",
    primaryLabel: 'Clock Out',
    primaryIcon: LogOut,
    secondaryLabel: 'Start Break',
    secondaryIcon: Coffee,
  },
  break: {
    heading: "You're On Break",
    primaryLabel: 'End Break',
    primaryIcon: Play,
    secondaryLabel: 'Clock Out',
    secondaryIcon: LogOut,
  },
  done: {
    heading: 'Shift Complete',
    primaryLabel: 'Clock In Now',
    primaryIcon: Fingerprint,
    secondaryLabel: 'Clock In Manually',
    secondaryIcon: MapPinOff,
  },
};

/** Ring stroke and status dot: green on shift, amber on break, grey when done. */
const RING: Record<ClockStage, { border: string; dot: string }> = {
  ready: { border: 'border-clock', dot: 'bg-clock' },
  working: { border: 'border-clock', dot: 'bg-clock' },
  break: { border: 'border-warning', dot: 'bg-warning' },
  done: {
    border: 'border-surface-border dark:border-surface-border-dark',
    dot: 'bg-content-muted dark:bg-content-muted-dark',
  },
};

interface ClockActionPaneProps {
  stage: ClockStage;
  /** Ticking wall clock, pre-formatted, e.g. "08:48:37". */
  clockTime: string;
  dateLabel: string;
  windowLabel: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
  /**
   * A third action, shown only when it exists. The screen uses it for the
   * manual fallback once the device has failed to supply a position: without
   * it, someone whose phone refuses a location can start a shift and never
   * end one (BUG-008).
   */
  tertiaryLabel?: string;
  onTertiary?: () => void;
  /**
   * Overrides the footer note. The default promises the location will be
   * recorded, which is untrue the moment the fallback above is the only way
   * through — and a screen that claims a GPS record it is not making is the
   * same class of defect as the one that made the fallback necessary.
   */
  locationNote?: ReactNode;
  /** Disables both actions while a write is in flight. */
  busy?: boolean;
  /** Slot under the actions. The location picker on the live screen. */
  children?: ReactNode;
}

/**
 * Right half of the clock-in hero card. The live clock and the actions that
 * actually start a shift.
 *
 * The reference's second action is "Scan QR Code" and it carries a third,
 * "Clock in using PIN". Neither method exists in the product: `clock_events`
 * records `gps | qr | manual`, nothing generates the per-location code a scan
 * would read, and there is no PIN anywhere in the schema. The slot is given to
 * manual clock-in instead. The real second method, rather than shipping a
 * button that cannot work. See docs/design/.loop/clockin-log.md.
 */
export function ClockActionPane({
  stage,
  clockTime,
  dateLabel,
  windowLabel,
  onPrimary,
  onSecondary,
  tertiaryLabel,
  onTertiary,
  locationNote,
  busy = false,
  children,
}: ClockActionPaneProps): JSX.Element {
  const copy = STAGES[stage];
  const ring = RING[stage];
  const PrimaryIcon = copy.primaryIcon;
  const SecondaryIcon = copy.secondaryIcon;

  return (
    <div className="flex flex-col items-center p-6">
      <h2 className="text-card-heading font-semibold text-content dark:text-content-dark">
        {copy.heading}
      </h2>

      <div
        className={cn(
          'mt-6 grid h-56 w-56 place-items-center rounded-full border-4 text-center',
          ring.border,
        )}
      >
        <div>
          <p className="text-page-title font-bold tracking-tight text-content dark:text-content-dark">
            {clockTime}
          </p>
          <p className="mt-1 text-sm font-semibold text-content dark:text-content-dark">
            {dateLabel}
          </p>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-content-muted dark:text-content-muted-dark">
            <span
              aria-hidden="true"
              className={cn('inline-block h-2 w-2 rounded-full', ring.dot)}
            />
            {windowLabel}
          </p>
        </div>
      </div>

      {/* Both actions are `Button` variants now, not hand-rolled markup.
          They carried their own `transition-transform duration-150` with no
          reduced-motion handling and their own `disabled:pointer-events-none`,
          which suppresses the hover that would explain why a control is
          unavailable — the exact two things `Button` had already fixed
          everywhere else. */}
      <Button
        variant="clock"
        onClick={onPrimary}
        disabled={busy}
        className="mt-8 h-14 w-full"
      >
        <PrimaryIcon size={20} aria-hidden="true" />
        {copy.primaryLabel}
      </Button>

      <div className="mt-5 flex w-full items-center gap-4">
        <span className="h-px flex-1 bg-divider dark:bg-divider-dark" />
        <span className="text-xs font-semibold text-content-muted dark:text-content-muted-dark">
          OR
        </span>
        <span className="h-px flex-1 bg-divider dark:bg-divider-dark" />
      </div>

      <Button
        variant="secondary"
        onClick={onSecondary}
        disabled={busy}
        className="mt-5 h-14 w-full"
      >
        <SecondaryIcon size={20} aria-hidden="true" />
        {copy.secondaryLabel}
      </Button>

      {tertiaryLabel && onTertiary ? (
        <Button
          variant="secondary"
          onClick={onTertiary}
          disabled={busy}
          className="mt-3 h-14 w-full"
        >
          <MapPinOff size={20} aria-hidden="true" />
          {tertiaryLabel}
        </Button>
      ) : null}

      {/* The only just-in-time notice the product had, and it said less than
          it needed to. "Recorded for accuracy" does not tell somebody that
          coordinates are stored, who can see them, or for how long — and this
          is the screen where a person is being asked for their physical
          location, which is the most intrusive thing the product collects. */}
      <p className="mt-4 flex items-start gap-1.5 text-xs text-content-muted dark:text-content-muted-dark">
        <ShieldCheck size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>
          {locationNote ??
            'Clocking in by GPS records your coordinates and how accurate the reading was, visible to your managers and kept for three years. Your browser asks first, and clocking in manually instead is always available.'}
        </span>
      </p>

      {children}
    </div>
  );
}
