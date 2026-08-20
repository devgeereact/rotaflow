import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';

export type ExceptionAvailability =
  'unavailable' | 'available_all_day' | 'available_from_midday';

export interface AddExceptionInput {
  date: string;
  availability: ExceptionAvailability;
}

interface AddExceptionModalProps {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  onConfirm: (input: AddExceptionInput) => void;
}

const TODAY = format(new Date(), 'yyyy-MM-dd');

/** A one-off date that overrides the standing weekly pattern
 * (`docs/ORGANISATION_WORKSPACE.html`'s "Add an exception"). The three
 * choices match the reference exactly; "from midday" is a fixed 12:00
 * rather than a free time picker, same as the reference offers. */
export function AddExceptionModal({
  open,
  onClose,
  busy,
  onConfirm,
}: AddExceptionModalProps): JSX.Element {
  const [date, setDate] = useState(TODAY);
  const [availability, setAvailability] = useState<ExceptionAvailability>('unavailable');

  useEffect(() => {
    if (open) {
      setDate(TODAY);
      setAvailability('unavailable');
    }
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Add an exception">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm({ date, availability });
        }}
      >
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          A one-off date that overrides your standing pattern.
        </p>

        <div className="mt-4">
          <Label htmlFor="exception-date">Date</Label>
          <input
            id="exception-date"
            type="date"
            required
            min={TODAY}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
          />
        </div>

        <div className="mt-4">
          <Label htmlFor="exception-availability">Availability</Label>
          <Select
            id="exception-availability"
            value={availability}
            onChange={(e) => setAvailability(e.target.value as ExceptionAvailability)}
          >
            <option value="unavailable">Unavailable all day</option>
            <option value="available_all_day">Available all day</option>
            <option value="available_from_midday">Available from midday</option>
          </Select>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save exception
          </Button>
        </div>
      </form>
    </Modal>
  );
}
