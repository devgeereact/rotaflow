import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Label } from '@/components/ui/Label';
import { cn } from '@/lib/utils';
import { fromIsoInTimezone, formatDayLabel } from '@/lib/rotaGrid';
import { isShiftClashError } from '@/lib/shiftConflicts';
import { paletteTokenForColour } from '@/lib/shiftPalette';
import type { Location, Shift, ShiftType, StaffProfile } from '@/types';

export interface AssignShiftFormValues {
  staffProfileId: string | null;
  date: string;
  /** Only meaningful for a brand-new shift — an edit keeps its original site. */
  locationId: string | null;
  shiftTypeId: string | null;
  startTime: string;
  endTime: string;
  breakMinutes: string;
  notes: string;
}

interface AssignShiftModalProps {
  open: boolean;
  onClose: () => void;
  staff: StaffProfile[];
  shiftTypes: ShiftType[];
  /** Every org location — lets a brand-new shift pick its site instead of inheriting a fixed one. */
  locations: Location[];
  dates: string[];
  timezone: string;
  /** Set for a brand-new shift (opened from an empty cell or "Add Shift"). */
  context?: { staffProfileId: string | null; date: string; locationId: string } | null;
  /** Set when editing an existing shift (opened from a chip). */
  shift?: Shift | null;
  onSave: (values: AssignShiftFormValues) => Promise<void>;
  onDelete?: (shiftId: string) => Promise<void>;
}

function blankValues(
  context:
    | { staffProfileId: string | null; date: string; locationId: string }
    | null
    | undefined,
  dates: string[],
): AssignShiftFormValues {
  return {
    staffProfileId: context?.staffProfileId ?? null,
    date: context?.date ?? dates[0] ?? '',
    locationId: context?.locationId ?? null,
    shiftTypeId: null,
    startTime: '09:00',
    endTime: '17:00',
    breakMinutes: '0',
    notes: '',
  };
}

function valuesFromShift(shift: Shift, timezone: string): AssignShiftFormValues {
  const { date, time: startTime } = fromIsoInTimezone(shift.starts_at, timezone);
  const { time: endTime } = fromIsoInTimezone(shift.ends_at, timezone);
  return {
    staffProfileId: shift.staff_profile_id,
    date,
    locationId: shift.location_id,
    shiftTypeId: shift.shift_type_id,
    startTime,
    endTime,
    breakMinutes: String(shift.break_minutes),
    notes: shift.notes ?? '',
  };
}

export function AssignShiftModal({
  open,
  onClose,
  staff,
  shiftTypes,
  locations,
  dates,
  timezone,
  context,
  shift,
  onSave,
  onDelete,
}: AssignShiftModalProps): JSX.Element {
  const [values, setValues] = useState<AssignShiftFormValues>(
    blankValues(context, dates),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues(shift ? valuesFromShift(shift, timezone) : blankValues(context, dates));
    setError(null);
  }, [open, shift, context, dates, timezone]);

  const handleShiftTypeChange = (shiftTypeId: string): void => {
    const type = shiftTypes.find((t) => t.id === shiftTypeId);
    setValues((v) => ({
      ...v,
      shiftTypeId: shiftTypeId || null,
      startTime: type?.default_start?.slice(0, 5) ?? v.startTime,
      endTime: type?.default_end?.slice(0, 5) ?? v.endTime,
    }));
  };

  const handleSave = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await onSave(values);
      onClose();
    } catch (err) {
      // A clash is a decision the manager can act on, so it is worth saying
      // out loud. Anything else stays generic, §45 keeps database errors off
      // the screen.
      setError(
        isShiftClashError(err)
          ? err.message
          : 'Could not save this shift. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!shift || !onDelete) return;
    setSubmitting(true);
    setError(null);
    try {
      await onDelete(shift.id);
      onClose();
    } catch {
      setError('Could not remove this shift.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={shift ? 'Edit shift' : 'Add shift'}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="as-staff">Staff</Label>
          <Select
            id="as-staff"
            value={values.staffProfileId ?? ''}
            onChange={(e) =>
              setValues((v) => ({ ...v, staffProfileId: e.target.value || null }))
            }
          >
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.first_name} {s.last_name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="as-date">Date</Label>
          <Select
            id="as-date"
            value={values.date}
            onChange={(e) => setValues((v) => ({ ...v, date: e.target.value }))}
          >
            {dates.map((d) => {
              const { weekday, day } = formatDayLabel(d);
              return (
                <option key={d} value={d}>
                  {weekday} {day}
                </option>
              );
            })}
          </Select>
        </div>

        {/* Only a brand-new shift can pick its site — an edit keeps the one
            it was created at, so the timezone used to save it never drifts
            from the timezone used to load it. */}
        {!shift && locations.length > 1 && (
          <div>
            <Label htmlFor="as-location">Location</Label>
            <Select
              id="as-location"
              value={values.locationId ?? ''}
              onChange={(e) =>
                setValues((v) => ({ ...v, locationId: e.target.value || null }))
              }
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div>
          <Label htmlFor="as-type-picker">Shift type</Label>
          <div id="as-type-picker" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {shiftTypes.map((t) => {
              const selected = values.shiftTypeId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleShiftTypeChange(t.id)}
                  aria-pressed={selected}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left transition-colors',
                    selected
                      ? 'border-primary bg-primary/5'
                      : 'border-surface-border hover:border-primary/40 dark:border-surface-border-dark',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-4 w-4 shrink-0 rounded-full',
                      paletteTokenForColour(t.colour),
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-content dark:text-content-dark">
                      {t.name}
                    </span>
                    {t.default_start && t.default_end && (
                      <span className="block text-xs text-content-muted dark:text-content-muted-dark">
                        {t.default_start.slice(0, 5)}, {t.default_end.slice(0, 5)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => handleShiftTypeChange('')}
              aria-pressed={!values.shiftTypeId}
              className={cn(
                'flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left transition-colors',
                !values.shiftTypeId
                  ? 'border-primary bg-primary/5'
                  : 'border-surface-border hover:border-primary/40 dark:border-surface-border-dark',
              )}
            >
              <span
                aria-hidden="true"
                className="h-4 w-4 shrink-0 rounded-full border-2 border-dashed border-content-muted dark:border-content-muted-dark"
              />
              <span className="text-sm font-medium text-content dark:text-content-dark">
                Custom
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="as-start">Start</Label>
            <Input
              id="as-start"
              type="time"
              value={values.startTime}
              onChange={(e) => setValues((v) => ({ ...v, startTime: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="as-end">End</Label>
            <Input
              id="as-end"
              type="time"
              value={values.endTime}
              onChange={(e) => setValues((v) => ({ ...v, endTime: e.target.value }))}
            />
          </div>
        </div>
        <p className="-mt-2 text-xs text-content-muted dark:text-content-muted-dark">
          End time before start time is treated as an overnight shift.
        </p>

        <div>
          <Label htmlFor="as-break">Break (minutes)</Label>
          <Input
            id="as-break"
            type="number"
            min="0"
            value={values.breakMinutes}
            onChange={(e) => setValues((v) => ({ ...v, breakMinutes: e.target.value }))}
          />
        </div>

        <div>
          <Label htmlFor="as-notes">Notes</Label>
          <Input
            id="as-notes"
            value={values.notes}
            onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-3">
          <Button
            className="flex-1"
            onClick={() => void handleSave()}
            disabled={submitting}
          >
            {submitting ? 'Saving…' : shift ? 'Save changes' : 'Add shift'}
          </Button>
          {shift && onDelete && (
            <Button
              variant="secondary"
              onClick={() => void handleDelete()}
              disabled={submitting}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
