import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { todayIso } from '@/lib/schedulePeriod';

export interface RaiseClaimDraft {
  date: string;
  hours: number;
  note: string;
}

interface RaiseClaimModalProps {
  open: boolean;
  onClose: () => void;
  submitting: boolean;
  onSubmit: (draft: RaiseClaimDraft) => void;
}

/** `SCREENS.overtime`'s "Raise an overtime claim" dialog. */
export function RaiseClaimModal({
  open,
  onClose,
  submitting,
  onSubmit,
}: RaiseClaimModalProps): JSX.Element {
  const [date, setDate] = useState(todayIso);
  const [hours, setHours] = useState('1');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setDate(todayIso());
      setHours('1');
      setNote('');
    }
  }, [open]);

  const parsedHours = Number(hours);
  const validHours = Number.isFinite(parsedHours) && parsedHours > 0 && parsedHours <= 24;

  return (
    <Modal open={open} onClose={onClose} title="Raise an overtime claim">
      <div className="space-y-4">
        <div>
          <Label htmlFor="overtime-date">Day</Label>
          <Input
            id="overtime-date"
            type="date"
            value={date}
            max={todayIso()}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="overtime-hours">Hours</Label>
          <Input
            id="overtime-hours"
            type="number"
            min="0.25"
            max="24"
            step="0.25"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
          {!validHours && (
            <p className="mt-1 text-xs text-danger">
              Enter more than zero and no more than 24 hours.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="overtime-reason">Reason</Label>
          <Input
            id="overtime-reason"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. covered a late finish on Ward 2"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={submitting || !validHours || !date}
            onClick={() => onSubmit({ date, hours: parsedHours, note: note.trim() })}
          >
            {submitting ? 'Submitting…' : 'Submit claim'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
