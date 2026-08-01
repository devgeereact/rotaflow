import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { isValidEmail } from '@/lib/email';
import { INVITE_ROLE_HINTS, INVITE_ROLE_LABELS } from '@/lib/staffInvites';
import type { MembershipRole } from '@/types';

interface InviteFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Rejects with the database's message, which is shown inline. */
  onSubmit: (email: string, role: MembershipRole) => Promise<void>;
  /** Owners only — a manager cannot mint an invite above their own role. */
  canInviteOwner: boolean;
}

const ROLE_ORDER: MembershipRole[] = ['staff', 'manager', 'owner'];

/** Mint an invitation. Opened from the Invitations tab of the Staff workspace. */
export function InviteFormModal({
  open,
  onClose,
  onSubmit,
  canInviteOwner,
}: InviteFormModalProps): JSX.Element {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MembershipRole>('staff');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reopening after a failure must not show the previous attempt's error.
  useEffect(() => {
    if (!open) return;
    setEmail('');
    setRole('staff');
    setError(null);
  }, [open]);

  const roles = ROLE_ORDER.filter((value) => canInviteOwner || value !== 'owner');

  const submit = async (): Promise<void> => {
    const trimmed = email.trim();
    if (!trimmed) return;
    if (!isValidEmail(trimmed)) {
      setError('That does not look like a valid email address.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed, role);
    } catch (err) {
      // The database raises specific messages (already a member, bad address,
      // insufficient role) that are more useful than a generic failure.
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not create that invitation.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Invite someone">
      <div className="space-y-4">
        <div>
          <Label htmlFor="invite-email">Email address</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="colleague@example.com"
          />
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            They must accept using this exact address — the invitation cannot be redeemed
            from any other account.
          </p>
        </div>

        <div>
          <Label htmlFor="invite-role">Role</Label>
          <Select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as MembershipRole)}
          >
            {roles.map((value) => (
              <option key={value} value={value}>
                {INVITE_ROLE_LABELS[value]}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            {INVITE_ROLE_HINTS[role]}
          </p>
        </div>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting || !email.trim()}>
            {submitting ? 'Creating…' : 'Create invitation'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
