import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';

const MIN_REASON = 5;

/**
 * Collects the reason a tenant is being suspended or archived.
 *
 * ## Why a modal and not `window.prompt`
 *
 * audit01 P0-2 was exactly this: five destructive actions sitting behind native
 * browser dialogs, all replaced with themed ones. A native prompt is unstyled,
 * unbranded, silently blocked in some contexts, and cannot show the caveat
 * below, which is the most important thing on this screen.
 *
 * ## What the caveat is doing here
 *
 * `organisations.status` is read by no RLS policy (0017). Suspending does not
 * sign anyone out. The person clicking this button is entitled to know that
 * before they click it, not after a customer asks why their staff are still
 * clocking in.
 */
export function SuspendOrgModal({
  open,
  organisationName,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  organisationName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  // Reopening must not show the previous attempt's text or its validation
  // error. This is a fresh decision each time.
  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);

  const tooShort = reason.trim().length < MIN_REASON;
  const showError = touched && tooShort;

  return (
    <Modal open={open} onClose={onCancel} title={`Suspend ${organisationName}?`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (tooShort) return;
          onConfirm(reason.trim());
        }}
      >
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          This marks the account suspended for billing and support, and records the change
          in this organisation’s own audit trail where their owner can read it.
        </p>

        <p className="mt-3 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm text-content dark:text-content-dark">
          It does <strong>not</strong> block access. Staff here can still sign in, view
          their rota and clock in. Enforcing a lockout needs a change to row-level
          security that has not been made.
        </p>

        <div className="mt-4">
          <Label htmlFor="suspend-reason">Reason</Label>
          <textarea
            id="suspend-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            rows={3}
            required
            aria-describedby={showError ? 'suspend-reason-error' : undefined}
            aria-invalid={showError}
            className="mt-1 w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none placeholder:text-content-muted focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
            placeholder="e.g. Payment failed three times; account on hold pending contact."
          />
          {showError ? (
            <p
              id="suspend-reason-error"
              role="alert"
              className="mt-1 text-xs text-danger"
            >
              Give at least {MIN_REASON} characters. The organisation’s owner sees this.
            </p>
          ) : (
            <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
              Visible to this organisation’s owner in their audit trail.
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            Suspend organisation
          </Button>
        </div>
      </form>
    </Modal>
  );
}
