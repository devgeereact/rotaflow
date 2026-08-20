import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import type { Shift, StaffProfile } from '@/types';

export interface OfferShiftDraft {
  shiftId: string;
  targetId: string;
  note: string;
}

interface OfferShiftModalProps {
  open: boolean;
  onClose: () => void;
  myShifts: Shift[];
  colleagues: StaffProfile[];
  submitting: boolean;
  offline: boolean;
  onSubmit: (draft: OfferShiftDraft) => void;
}

/**
 * `SCREENS.swaps`'s "Offer a shift" dialog. The reference's version is
 * shift + reason only; this keeps the real, richer "offer to" field — naming
 * a colleague directly is a genuine capability the mockup has no equivalent
 * for, and cutting it would be a regression, not fidelity.
 */
export function OfferShiftModal({
  open,
  onClose,
  myShifts,
  colleagues,
  submitting,
  offline,
  onSubmit,
}: OfferShiftModalProps): JSX.Element {
  const [shiftId, setShiftId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setShiftId('');
      setTargetId('');
      setNote('');
    }
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Offer a shift">
      {myShifts.length === 0 ? (
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          You have no published upcoming shifts to offer.
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <Label htmlFor="offer-shift">Shift</Label>
            <Select
              id="offer-shift"
              value={shiftId}
              onChange={(e) => setShiftId(e.target.value)}
            >
              <option value="">Select a shift</option>
              {myShifts.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {format(new Date(shift.starts_at), 'EEE d MMM · HH:mm')}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="offer-target">Offer to (optional)</Label>
            <Select
              id="offer-target"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              <option value="">Anyone / manager decides</option>
              {colleagues.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="offer-reason">Reason</Label>
            <Input
              id="offer-reason"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Your colleagues see this."
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
              disabled={submitting || !shiftId}
              onClick={() => onSubmit({ shiftId, targetId, note })}
            >
              {submitting ? 'Submitting…' : 'Post to the swap board'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
