import { Fingerprint, QrCode, ShieldCheck } from 'lucide-react';

interface ClockActionPaneProps {
  /** Ticking wall clock, pre-formatted, e.g. "08:48:37". */
  clockTime: string;
  dateLabel: string;
  windowLabel: string;
  onClockIn?: () => void;
  onScanQr?: () => void;
  onUsePin?: () => void;
}

/**
 * Right half of the clock-in hero card — the live clock and the actions that
 * actually start a shift.
 */
export function ClockActionPane({
  clockTime,
  dateLabel,
  windowLabel,
  onClockIn,
  onScanQr,
  onUsePin,
}: ClockActionPaneProps): JSX.Element {
  return (
    <div className="flex flex-col items-center p-6">
      <h2 className="text-card-heading font-semibold text-content dark:text-content-dark">
        Ready to Clock In?
      </h2>

      <div className="mt-6 grid h-56 w-56 place-items-center rounded-full border-4 border-clock text-center">
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
              className="inline-block h-2 w-2 rounded-full bg-clock"
            />
            {windowLabel}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onClockIn}
        className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-lg bg-clock text-base font-semibold text-primary-fg transition-transform duration-150 ease-in-out hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clock focus-visible:ring-offset-2"
      >
        <Fingerprint size={20} aria-hidden="true" />
        Clock In Now
      </button>

      <div className="mt-5 flex w-full items-center gap-4">
        <span className="h-px flex-1 bg-divider dark:bg-divider-dark" />
        <span className="text-xs font-semibold text-content-muted dark:text-content-muted-dark">
          OR
        </span>
        <span className="h-px flex-1 bg-divider dark:bg-divider-dark" />
      </div>

      <button
        type="button"
        onClick={onScanQr}
        className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-lg border border-surface-border bg-surface text-base font-semibold text-content transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
      >
        <QrCode size={20} aria-hidden="true" />
        Scan QR Code
      </button>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-content-muted dark:text-content-muted-dark">
        <ShieldCheck size={14} aria-hidden="true" />
        Your location will be recorded for accuracy
      </p>

      <button
        type="button"
        onClick={onUsePin}
        className="mt-4 rounded text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        Clock in using PIN
      </button>
    </div>
  );
}
