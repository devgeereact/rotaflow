import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { AlertTriangle, History } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { AttendanceStatusBadge } from '@/components/attendance/AttendanceStatusBadge';
import { fromIsoInTimezone, toIsoInTimezone } from '@/lib/rotaGrid';
import type { AttendanceViewRow } from '@/lib/attendanceRows';
import type { ClockEventCorrection } from '@/types';

const EVENT_LABEL: Record<string, string> = {
  in: 'Clocked in',
  out: 'Clocked out',
  break_start: 'Break started',
  break_end: 'Break ended',
};

export interface AttendanceCorrectionInput {
  clockEventId: string;
  /** The `updated_at` this modal was opened against. */
  expectedUpdatedAt: string;
  /** New instant, ISO. */
  eventAt: string;
  reason: string;
}

export interface AttendanceDetailModalProps {
  open: boolean;
  onClose: () => void;
  row: AttendanceViewRow | null;
  corrections: ClockEventCorrection[];
  correctionsLoading: boolean;
  /** True while a correction is in flight. */
  busy: boolean;
  /** Null when the viewer may look but not change. */
  onCorrect: ((input: AttendanceCorrectionInput) => void) | null;
  /** Set after a failed correction, e.g. a stale write. Cleared on reopen. */
  error: string | null;
}

const MIN_REASON = 3;

/**
 * One attendance row in full: the whole event timeline, planned against
 * actual, why it is flagged, what has been corrected before, and the
 * correction form.
 *
 * ## Why the timeline is every event, not just in and out
 *
 * A break started and never ended changes the hours by however long the rest
 * of the shift ran. That deduction is the single most common thing a person
 * queries, and it is invisible on a row that shows only the two ends. Every
 * event the segment contains is listed, in order, with its recorded source.
 *
 * ## What the correction form does not do
 *
 * It does not offer to "fix" a missing clock-out by inventing one. Where an
 * event does not exist there is nothing to correct, and the honest action is
 * to record a new one from the timesheet screen, which is where a manual
 * event is created and where the reason already lands. This form edits an
 * event that exists.
 *
 * ## Freshness
 *
 * Everything here is what reached the server. A clock-in queued on a phone
 * with no signal is not visible to anybody but that phone
 * (`docs/OFFLINE-SPEC.md`), so the panel says so rather than letting an empty
 * timeline read as proof of absence.
 */
export function AttendanceDetailModal({
  open,
  onClose,
  row,
  corrections,
  correctionsLoading,
  busy,
  onCorrect,
  error,
}: AttendanceDetailModalProps): JSX.Element {
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [eventId, setEventId] = useState('');
  const [touched, setTouched] = useState(false);

  const events = row?.row.events ?? [];

  useEffect(() => {
    if (!open || !row) return;
    const first = row.row.events[0];
    setEventId(first?.id ?? '');
    setTime(first ? fromIsoInTimezone(first.event_at, row.timezone).time : '');
    setReason('');
    setTouched(false);
  }, [open, row]);

  if (!row) {
    return (
      <Modal open={open} onClose={onClose} title="Attendance">
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Nothing selected.
        </p>
      </Modal>
    );
  }

  const selected = events.find((event) => event.id === eventId) ?? null;
  const reasonValid = reason.trim().length >= MIN_REASON;
  const canSubmit = onCorrect !== null && selected !== null && reasonValid && !busy;

  const submit = (): void => {
    setTouched(true);
    if (!canSubmit || !selected) return;
    const date = fromIsoInTimezone(selected.event_at, row.timezone).date;
    onCorrect({
      clockEventId: selected.id,
      expectedUpdatedAt: selected.updated_at,
      eventAt: toIsoInTimezone(date, time, row.timezone),
      reason: reason.trim(),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${row.name} · attendance`}
      dirty={reasonValid}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <AttendanceStatusBadge status={row.status} />
          <span className="text-sm text-content-muted dark:text-content-muted-dark">
            {row.statusDefinition}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-3 rounded-xl bg-surface-subtle p-3 text-sm dark:bg-surface-subtle-dark">
          <div>
            <dt className="text-xs text-content-muted dark:text-content-muted-dark">
              Planned
            </dt>
            <dd className="font-mono text-content dark:text-content-dark">
              {row.plannedLabel}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-content-muted dark:text-content-muted-dark">
              Actual
            </dt>
            <dd className="font-mono text-content dark:text-content-dark">
              {row.actualLabel}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-content-muted dark:text-content-muted-dark">
              Worked (net of break)
            </dt>
            <dd className="font-mono text-content dark:text-content-dark">
              {row.workedLabel}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-content-muted dark:text-content-muted-dark">
              Variance
            </dt>
            <dd className="font-mono text-content dark:text-content-dark">
              {row.varianceLabel}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-content-muted dark:text-content-muted-dark">
              Times shown in
            </dt>
            <dd className="text-content dark:text-content-dark">
              {row.timezone}
              {row.locationName ? ` · ${row.locationName}` : ''}
            </dd>
          </div>
        </dl>

        {row.issue && (
          <p className="flex items-start gap-2 rounded-xl bg-warning-wash px-3 py-2 text-sm text-warning-ink dark:bg-warning-wash-dark dark:text-warning-ink-dark">
            <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            {row.issue}
          </p>
        )}

        {row.row.matchedByProximity && row.row.actualInIso && (
          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            This clock-in did not record which shift it belonged to, so it was matched to
            this one by the closest start time. Check it before treating the variance as
            final.
          </p>
        )}

        <section>
          <h3 className="mb-2 text-sm font-semibold text-content dark:text-content-dark">
            Event timeline
          </h3>
          {events.length === 0 ? (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              No clock events have reached the server for this shift. If this person
              clocked in offline, their device still holds the record and it will appear
              here once it syncs — nothing here can see it before then.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
                >
                  <span className="font-mono text-content dark:text-content-dark">
                    {format(
                      toZonedTime(new Date(event.event_at), row.timezone),
                      'd MMM HH:mm',
                    )}
                  </span>
                  <span className="font-medium text-content dark:text-content-dark">
                    {EVENT_LABEL[event.type] ?? event.type}
                  </span>
                  <span className="text-xs text-content-muted dark:text-content-muted-dark">
                    {event.method}
                    {event.location_name ? ` · ${event.location_name}` : ''}
                    {event.event_at_reported
                      ? ' · device time was adjusted on arrival'
                      : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-content dark:text-content-dark">
            <History size={14} aria-hidden="true" />
            Correction history
          </h3>
          {correctionsLoading ? (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              Loading…
            </p>
          ) : corrections.length === 0 ? (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              No manual corrections.
            </p>
          ) : (
            <ul className="space-y-2">
              {corrections.map((correction) => {
                const before = correction.before_value as { event_at?: string };
                const after = correction.after_value as { event_at?: string };
                return (
                  <li
                    key={correction.id}
                    className="rounded-xl border border-surface-border p-2.5 text-sm dark:border-surface-border-dark"
                  >
                    <p className="font-mono text-xs text-content dark:text-content-dark">
                      {before.event_at
                        ? format(
                            toZonedTime(new Date(before.event_at), row.timezone),
                            'd MMM HH:mm',
                          )
                        : '?'}
                      {' → '}
                      {after.event_at
                        ? format(
                            toZonedTime(new Date(after.event_at), row.timezone),
                            'd MMM HH:mm',
                          )
                        : '?'}
                    </p>
                    <p className="text-content dark:text-content-dark">
                      {correction.reason}
                    </p>
                    <p className="text-xs text-content-muted dark:text-content-muted-dark">
                      {correction.actor_name ?? 'Unknown'} ·{' '}
                      {format(new Date(correction.created_at), 'd MMM yyyy HH:mm')}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {onCorrect === null ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            You can read this record but not change it. Correcting an attendance record
            needs owner or manager permission.
          </p>
        ) : events.length === 0 ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            There is no event here to correct. To record one by hand, use Amend on the
            Timesheets screen — that is where a missing clock-in or clock-out is created.
          </p>
        ) : (
          <section className="space-y-3 border-t border-surface-border pt-4 dark:border-surface-border-dark">
            <h3 className="text-sm font-semibold text-content dark:text-content-dark">
              Correct an event
            </h3>

            <Field label="Event">
              <select
                value={eventId}
                onChange={(e) => {
                  setEventId(e.target.value);
                  const next = events.find((event) => event.id === e.target.value);
                  setTime(
                    next ? fromIsoInTimezone(next.event_at, row.timezone).time : '',
                  );
                }}
                className="h-11 w-full rounded-xl border border-surface-border bg-background px-3 text-content dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
              >
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {EVENT_LABEL[event.type] ?? event.type} ·{' '}
                    {format(
                      toZonedTime(new Date(event.event_at), row.timezone),
                      'd MMM HH:mm',
                    )}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={`Corrected time (${row.timezone})`}>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-11 w-full rounded-xl border border-surface-border bg-background px-3 text-content dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
              />
            </Field>

            <Field
              label="Reason"
              error={
                touched && !reasonValid ? 'Say why this is being changed.' : undefined
              }
              hint="Recorded permanently against this record, with your name and the previous value."
            >
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-xl border border-surface-border bg-background px-3 py-2 text-content dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
              />
            </Field>

            {error && (
              <p
                role="alert"
                className="text-sm text-danger-ink dark:text-danger-ink-dark"
              >
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy}>
                {busy ? 'Saving…' : 'Save correction'}
              </Button>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
