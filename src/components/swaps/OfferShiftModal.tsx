import { useEffect, useState, type JSX } from 'react';
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
  /** Two-way swaps (S12d): one of the colleague's shifts asked for in return. Absent otherwise. */
  takeShiftId?: string;
}

/** A colleague's shift that can be asked for in return (`GET swaps/options`). */
export interface ExchangeOption {
  id: string;
  staff_profile_id: string;
  starts_at: string;
  ends_at: string;
}

interface OfferShiftModalProps {
  open: boolean;
  onClose: () => void;
  myShifts: Shift[];
  colleagues: StaffProfile[];
  submitting: boolean;
  offline: boolean;
  onSubmit: (draft: OfferShiftDraft) => void;
  /**
   * Two-way swaps (S12d, `two_way_swaps` with `cover_tools`). Undefined with the flags off, so the
   * dialog is exactly as before.
   */
  exchangeShifts?: ExchangeOption[];
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
  exchangeShifts,
}: OfferShiftModalProps): JSX.Element {
  const [shiftId, setShiftId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [note, setNote] = useState('');
  const [takeShiftId, setTakeShiftId] = useState('');

  useEffect(() => {
    if (open) {
      setShiftId('');
      setTargetId('');
      setNote('');
      setTakeShiftId('');
    }
  }, [open]);

  const theirShifts = (exchangeShifts ?? []).filter(
    (x) => x.staff_profile_id === targetId,
  );

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
              onChange={(e) => {
                setTargetId(e.target.value);
                setTakeShiftId('');
              }}
            >
              <option value="">Anyone / manager decides</option>
              {colleagues.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name}
                </option>
              ))}
            </Select>
          </div>
          {exchangeShifts && targetId && (
            <div>
              <Label htmlFor="offer-take">In return (optional)</Label>
              <Select
                id="offer-take"
                value={takeShiftId}
                onChange={(e) => setTakeShiftId(e.target.value)}
              >
                <option value="">Nothing, just take my shift</option>
                {theirShifts.map((x) => (
                  <option key={x.id} value={x.id}>
                    {format(new Date(x.starts_at), 'EEE d MMM · HH:mm')}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
                {theirShifts.length === 0
                  ? 'They have no upcoming shifts to swap back.'
                  : 'Asking for one of their shifts makes it a swap both ways: when approved, you each take the other’s shift.'}
              </p>
            </div>
          )}
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
              onClick={() =>
                onSubmit(
                  takeShiftId && targetId
                    ? { shiftId, targetId, note, takeShiftId }
                    : { shiftId, targetId, note },
                )
              }
            >
              {submitting ? 'Submitting…' : 'Post to the swap board'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
