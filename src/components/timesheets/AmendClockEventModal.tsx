import { useEffect, useState } from 'react';
import { fromIsoInTimezone } from '@/lib/rotaGrid';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
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

  // Events whose submitted time the 0068 guard replaced. `event_at_reported`
  // is null on every ordinary event, so this is empty in the normal case.
  const overrides = [
    { label: 'Clock in', event: clockInEvent },
    { label: 'Clock out', event: clockOutEvent },
  ].flatMap(({ label, event }) =>
    event?.event_at_reported
      ? [
          {
            label,
            reported: fromIsoInTimezone(event.event_at_reported, timezone).time,
            recorded: fromIsoInTimezone(event.event_at, timezone).time,
          },
        ]
      : [],
  );

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

        {overrides.length > 0 && (
          // The whole reason 0068 exists. Before it, the guard rewrote these
          // times to the moment they synced and said nothing, so the one
          // person who could correct a mis-timed shift never learned there
          // was anything to correct.
          <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 p-3">
            <p className="text-sm font-medium text-warning-ink dark:text-warning-ink-dark">
              {overrides.length === 1
                ? 'One of these times was adjusted automatically'
                : 'These times were adjusted automatically'}
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-content-muted dark:text-content-muted-dark">
              {overrides.map((o) => (
                <li key={o.label}>
                  {o.label}: the device reported{' '}
                  <span className="font-mono">{o.reported}</span>, recorded as{' '}
                  <span className="font-mono">{o.recorded}</span>.
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-content-muted dark:text-content-muted-dark">
              This happens when a phone syncs more than 72 hours late, or its clock is
              wrong. If the reported time is the real one, correct it below.
            </p>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Clock in">
            <input
              type="time"
              value={clockInTime}
              onChange={(e) => setClockInTime(e.target.value)}
              onBlur={() => setTouched(true)}
              className="w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
            />
          </Field>
          <Field label="Clock out">
            <input
              type="time"
              value={clockOutTime}
              onChange={(e) => setClockOutTime(e.target.value)}
              onBlur={() => setTouched(true)}
              className="w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
            />
          </Field>
        </div>
        {/* This one belongs to the pair, not to either field. */}
        {showNoChangeError && (
          <p
            role="alert"
            className="mt-1.5 text-xs font-medium text-danger-ink dark:text-danger-ink-dark"
          >
            Set a clock-in or clock-out time to amend.
          </p>
        )}

        {/* `Field`, so the hint and the error are both present rather than the
            hint being replaced by the error. "Recorded in the audit trail" is
            the reason the length rule exists, and it was disappearing exactly
            when somebody was struggling to satisfy it. */}
        <Field
          label="Reason"
          required
          className="mt-4"
          hint="Recorded in the organisation's audit trail alongside this correction."
          error={showReasonError ? `Give at least ${MIN_REASON} characters.` : null}
        >
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            rows={3}
            className="w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none placeholder:text-content-muted focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
            placeholder="e.g. Forgot to clock out, confirmed with them they left at 17:00."
          />
        </Field>

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
