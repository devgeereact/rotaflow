import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { LEAVE_TYPE_LABEL } from '@/lib/leaveStatus';
import type { LeaveTypeKey } from '@/lib/leaveRows';

export interface LeaveRequestDraft {
  type: LeaveTypeKey;
  startDate: string;
  endDate: string;
  reason: string;
}

interface LeaveRequestModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: LeaveRequestDraft) => void;
  submitting: boolean;
  /** Shown under the actions when the device is offline — the write is queued. */
  offline: boolean;
}

const TYPES: LeaveTypeKey[] = ['annual', 'sick', 'personal', 'carer', 'other'];

/** The "Request Leave" dialog behind the header CTA (design/Leave.png). */
export function LeaveRequestModal({
  open,
  onClose,
  onSubmit,
  submitting,
  offline,
}: LeaveRequestModalProps): JSX.Element | null {
  const [type, setType] = useState<LeaveTypeKey>('annual');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

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
            disabled={submitting || !startDate || !endDate}
            onClick={() => onSubmit({ type, startDate, endDate, reason })}
          >
            {submitting ? 'Submitting…' : 'Submit request'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
