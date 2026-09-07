import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';

const MIN_REASON = 5;

interface DeclineLeaveModalProps {
  open: boolean;
  staffName: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  busy: boolean;
}

/**
 * Collects the mandatory decline reason (`docs/ORGANISATION_WORKSPACE.html`'s
 * inline "Decline" button, given a reason field here it never draws — a
 * decline with no reason recorded anywhere is worse than one extra dialog).
 * `leave_requests` has no column of its own for it, so the reason is only
 * ever persisted via `logAuditEvent('leave.reviewed', ...)`, same as
 * `SuspendOrgModal`'s pattern for a suspension reason.
 */
export function DeclineLeaveModal({
  open,
  staffName,
  onClose,
  onConfirm,
  busy,
}: DeclineLeaveModalProps): JSX.Element {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);

  const tooShort = reason.trim().length < MIN_REASON;
  const showError = touched && tooShort;

  return (
    <Modal open={open} onClose={onClose} title={`Decline ${staffName}'s request?`}>
      <div className="space-y-4">
        {/* The hint stays visible alongside the error rather than being
            replaced by it: "recorded in the audit trail" is the context that
            makes the length requirement make sense, and it was disappearing
            exactly when the person needed it. `Field` fixes that order for
            every form (docs/DESIGN.md §6). */}
        <Field
          label="Reason"
          required
          hint={`Recorded in the audit trail, not shown to ${staffName} on this screen.`}
          error={
            showError
              ? `Give at least ${MIN_REASON} characters. It is recorded in the audit trail.`
              : null
          }
        >
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            rows={3}
            className="w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none placeholder:text-content-muted focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
            placeholder="e.g. Two other team members are already off that week."
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              setTouched(true);
              if (tooShort) return;
              onConfirm(reason.trim());
            }}
          >
            {busy ? 'Declining…' : 'Decline request'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
