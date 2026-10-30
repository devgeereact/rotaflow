import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { ClashingShift } from '@/services/leaveService';

/**
 * After a leave approval (slice S11, `scheduling_tools` flag): the person's shifts that now fall
 * inside the leave, so the manager can arrange cover. The leave is already approved; nothing
 * here undoes it, and the shifts are not changed automatically.
 */
interface LeaveClashModalProps {
  open: boolean;
  onClose: () => void;
  personName: string;
  shifts: ClashingShift[];
}

const FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function LeaveClashModal({
  open,
  onClose,
  personName,
  shifts,
}: LeaveClashModalProps): JSX.Element {
  const navigate = useNavigate();
  return (
    <Modal open={open} onClose={onClose} title="Leave approved: shifts to cover">
      <div className="space-y-4">
        <p className="text-sm text-content dark:text-content-dark">
          {personName} is still rostered on {shifts.length}{' '}
          {shifts.length === 1 ? 'shift' : 'shifts'} during this leave. Reassign{' '}
          {shifts.length === 1 ? 'it' : 'them'} or offer{' '}
          {shifts.length === 1 ? 'it' : 'them'} as open shifts.
        </p>
        <ul className="space-y-1 text-sm text-content dark:text-content-dark">
          {shifts.map((s) => (
            <li key={s.id}>
              {FORMAT.format(new Date(s.starts_at))} to{' '}
              {FORMAT.format(new Date(s.ends_at))}
              {s.rota_status === 'draft' ? ' (draft rota)' : ''}
            </li>
          ))}
        </ul>
        <div className="flex gap-3">
          <Button className="flex-1" onClick={() => void navigate('/app/rota')}>
            Open the rota
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Later
          </Button>
        </div>
      </div>
    </Modal>
  );
}
