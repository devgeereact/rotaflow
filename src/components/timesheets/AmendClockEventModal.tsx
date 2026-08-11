import { useEffect, useState } from 'react';
import { fromIsoInTimezone } from '@/lib/rotaGrid';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import type { ClockEvent } from '@/types';

const MIN_REASON = 5;

export interface AmendClockEventInput {
  clockInTime: string | null;
  clockOutTime: string | null;
  reason: string;
}

interface AmendClockEventModalProps {
  open: boolean;
  onClose: () => void;
  staffName: string;
  dayLabel: string;
  timezone: string;
  clockInEvent: ClockEvent | null;
  clockOutEvent: ClockEvent | null;
  busy: boolean;
  onConfirm: (input: AmendClockEventInput) => void;
}

/**
 * Corrects one person's recorded clock-in/out time for one day
 * (`docs/ORGANISATION_WORKSPACE.html`'s "Amend {name}'s hours?"). Backed by
 * `clockService.updateClockEvent` / `recordClockEvent`, which the caller
 * chooses between per field depending on whether an event already exists —
 * this component only collects the correction.
 *
 * `clock_events` itself has no history column, so there is no "original
 * value" to show inline the way the reference's copy implies. The reason
 * below is what actually survives: it is written to `audit_logs` via
 * `logAuditEvent('timesheet.amended', ...)` (0039), alongside the row's own
 * bumped `updated_at`.
 */
export function AmendClockEventModal({
  open,
  onClose,
  staffName,
  dayLabel,
  timezone,
  clockInEvent,
  clockOutEvent,
  busy,
  onConfirm,
}: AmendClockEventModalProps): JSX.Element {
  const [clockInTime, setClockInTime] = useState('');
  const [clockOutTime, setClockOutTime] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClockInTime(
      clockInEvent ? fromIsoInTimezone(clockInEvent.event_at, timezone).time : '',
    );
    setClockOutTime(
      clockOutEvent ? fromIsoInTimezone(clockOutEvent.event_at, timezone).time : '',
    );
    setReason('');
    setTouched(false);
  }, [open, clockInEvent, clockOutEvent, timezone]);

  const noChange = clockInTime.trim() === '' && clockOutTime.trim() === '';
  const tooShort = reason.trim().length < MIN_REASON;
  const invalid = noChange || tooShort;
  const showNoChangeError = touched && noChange;
  const showReasonError = touched && !noChange && tooShort;

  return (
    <Modal open={open} onClose={onClose} title={`Amend ${staffName}'s hours?`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (invalid) return;
          onConfirm({
            clockInTime: clockInTime.trim() || null,
            clockOutTime: clockOutTime.trim() || null,
            reason: reason.trim(),
          });
        }}
      >
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          {dayLabel}. This updates the recorded clock time directly. The original value
          isn&rsquo;t kept on the event itself, only your reason below and this
          row&rsquo;s last-updated timestamp.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="amend-in">Clock in</Label>
            <input
              id="amend-in"
              type="time"
              value={clockInTime}
              onChange={(e) => setClockInTime(e.target.value)}
              onBlur={() => setTouched(true)}
              className="mt-1 w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
            />
          </div>
          <div>
            <Label htmlFor="amend-out">Clock out</Label>
            <input
              id="amend-out"
              type="time"
              value={clockOutTime}
              onChange={(e) => setClockOutTime(e.target.value)}
              onBlur={() => setTouched(true)}
              className="mt-1 w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
            />
          </div>
        </div>
        {showNoChangeError && (
          <p role="alert" className="mt-1 text-xs text-danger">
            Set a clock-in or clock-out time to amend.
          </p>
        )}

        <div className="mt-4">
          <Label htmlFor="amend-reason">Reason</Label>
          <textarea
            id="amend-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            rows={3}
            required
            aria-describedby={showReasonError ? 'amend-reason-error' : undefined}
            aria-invalid={showReasonError}
            className="mt-1 w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none placeholder:text-content-muted focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
            placeholder="e.g. Forgot to clock out, confirmed with them they left at 17:00."
          />
          {showReasonError ? (
            <p id="amend-reason-error" role="alert" className="mt-1 text-xs text-danger">
              Give at least {MIN_REASON} characters.
            </p>
          ) : (
            <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
              Recorded in the organisation&rsquo;s audit trail alongside this correction.
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save amendment
          </Button>
        </div>
      </form>
    </Modal>
  );
}
