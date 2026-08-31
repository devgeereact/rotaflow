import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { LEAVE_TYPE_LABEL } from '@/lib/leaveStatus';
import { bankHolidaysBetween, type BankHolidayRegion } from '@/lib/bankHolidays';
import { formatLeaveDuration, leaveDayCount, type LeaveTypeKey } from '@/lib/leaveRows';

export interface LeaveRequestDraft {
  type: LeaveTypeKey;
  startDate: string;
  endDate: string;
  reason: string;
  /** The first day begins at midday, so it counts as half (CAP-085). */
  startsHalf: boolean;
  /** The last day ends at midday. */
  endsHalf: boolean;
}

interface LeaveRequestModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: LeaveRequestDraft) => void;
  submitting: boolean;
  /** Shown under the actions when the device is offline. The write is queued. */
  offline: boolean;
  /** Which nation's bank holidays this organisation observes (CAP-009). */
  bankHolidayRegion: BankHolidayRegion;
}

const TYPES: LeaveTypeKey[] = ['annual', 'sick', 'personal', 'carer', 'other'];

/** The "Request Leave" dialog behind the header CTA (docs/design/Leave.png). */
export function LeaveRequestModal({
  open,
  onClose,
  onSubmit,
  submitting,
  offline,
  bankHolidayRegion,
}: LeaveRequestModalProps): JSX.Element | null {
  const [type, setType] = useState<LeaveTypeKey>('annual');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [startsHalf, setStartsHalf] = useState(false);
  const [endsHalf, setEndsHalf] = useState(false);
  // `min` on the End input only constrains typing/picking, and doesn't
  // re-validate if Start changes afterward to land after an already-chosen
  // End — there's no <form> here so the browser's own constraint validation
  // never runs either. Reversed ranges used to submit silently: entitlement
  // clamped the day count to 0, the leave table clamped it back up to 1, and
  // rotaInsights' leaveCovers never matched, so the person was never flagged
  // as on leave — approved leave that blocked nothing and cost no allowance.
  const reversedRange = Boolean(startDate && endDate && endDate < startDate);

  // Named before the request is sent, not after it is approved (CAP-009).
  // Somebody booking the week around Christmas is usually asking for fewer
  // days than the calendar shows, and finding that out from their remaining
  // balance in March is the wrong moment.
  const singleDay = Boolean(startDate) && startDate === endDate;

  const holidays =
    startDate && endDate && !reversedRange
      ? bankHolidaysBetween(startDate, endDate, bankHolidayRegion)
      : [];

  return (
    <Modal open={open} onClose={onClose} title="Request leave">
      <div className="space-y-4">
        <div>
          <Label htmlFor="leave-type">Leave type</Label>
          <Select
            id="leave-type"
            value={type}
            onChange={(event) => setType(event.target.value as LeaveTypeKey)}
          >
            {TYPES.map((key) => (
              <option key={key} value={key}>
                {LEAVE_TYPE_LABEL[key]}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="leave-start">Start date</Label>
            <Input
              id="leave-start"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="leave-end">End date</Label>
            <Input
              id="leave-end"
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
        </div>

        {reversedRange && (
          <p className="text-xs text-danger">
            The end date is before the start date. Pick an end date on or after the start
            date.
          </p>
        )}

        {/* One tick for a single day, two for a range. Asking somebody
            booking a Friday afternoon to reason about "starts half" AND
            "ends half" on the same date is how a half day gets booked as a
            whole one. (CAP-085) */}
        {startDate && endDate && !reversedRange && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-content dark:text-content-dark">
              Half days
            </legend>
            {singleDay ? (
              <label className="flex items-center gap-2 text-sm text-content dark:text-content-dark">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-surface-border"
                  checked={startsHalf || endsHalf}
                  onChange={(event) => {
                    setStartsHalf(event.target.checked);
                    setEndsHalf(event.target.checked);
                  }}
                />
                Half a day
              </label>
            ) : (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-content dark:text-content-dark">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-surface-border"
                    checked={startsHalf}
                    onChange={(event) => setStartsHalf(event.target.checked)}
                  />
                  First day starts after lunch
                </label>
                <label className="flex items-center gap-2 text-sm text-content dark:text-content-dark">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-surface-border"
                    checked={endsHalf}
                    onChange={(event) => setEndsHalf(event.target.checked)}
                  />
                  Last day ends at lunch
                </label>
              </div>
            )}
            <p className="mt-2 text-xs text-content-muted dark:text-content-muted-dark">
              This request costs{' '}
              {formatLeaveDuration(
                leaveDayCount(startDate, endDate, startsHalf, endsHalf),
              )}
              .
            </p>
          </fieldset>
        )}

        {holidays.length > 0 && (
          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            {holidays.length === 1
              ? `${holidays[0]?.name} (${new Date(`${holidays[0]?.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}) falls in this range.`
              : `${holidays.length} bank holidays fall in this range: ${holidays.map((h) => h.name).join(', ')}.`}{' '}
            Your organisation decides whether those come out of your allowance.
          </p>
        )}

        <div>
          <Label htmlFor="leave-reason">Reason (optional)</Label>
          <Input
            id="leave-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Family holiday"
          />
        </div>

        {offline && (
          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            You&rsquo;re offline. This request is saved on the device and sent when
            you&rsquo;re back online.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={submitting || !startDate || !endDate || reversedRange}
            onClick={() =>
              onSubmit({ type, startDate, endDate, reason, startsHalf, endsHalf })
            }
          >
            {submitting ? 'Submitting…' : 'Submit request'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
