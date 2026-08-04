import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import {
  SUPPORT_ACCESS_DURATIONS,
  validateRequest,
  type SupportAccessScope,
} from '@/lib/supportAccess';
import type { Organisation } from '@/types';

/**
 * The request-support-access form.
 *
 * Lifted out of AdminSupportAccessPage so the support tools screen can open the
 * same dialog. Two copies of a form whose fields are enforced by database
 * CHECK constraints is two places for the client-side copy of those rules to
 * drift from the server's — and the one that drifts is the one that starts
 * showing a Postgres error code instead of a sentence.
 *
 * `orgId` can be pre-filled: from the support tools screen you are already
 * looking at a specific customer, and re-picking them from a dropdown of every
 * tenant is a step that exists only because the component was written for the
 * other page first.
 */

interface RequestInput {
  orgId: string;
  reason: string;
  caseRef: string;
  scope: SupportAccessScope;
  minutes: number;
}

export function RequestSupportAccessModal({
  open,
  orgs,
  busy,
  initialOrgId = '',
  onClose,
  onSubmit,
}: {
  open: boolean;
  orgs: readonly Organisation[];
  busy: boolean;
  /** Pre-select a tenant when the caller already knows which one. */
  initialOrgId?: string;
  onClose: () => void;
  onSubmit: (input: RequestInput) => Promise<void>;
}): JSX.Element {
  const [orgId, setOrgId] = useState(initialOrgId);

  // The support tools screen keeps one modal mounted and swaps which customer
  // it is about, so the field has to follow the prop rather than only seeding
  // from it on first mount.
  useEffect(() => {
    setOrgId(initialOrgId);
  }, [initialOrgId]);
  const [reason, setReason] = useState('');
  const [caseRef, setCaseRef] = useState('');
  const [scope, setScope] = useState<SupportAccessScope>('read');
  const [minutes, setMinutes] = useState(60);
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (): void => {
    const found = validateRequest({ orgId, reason, caseRef, minutes });
    const all: Record<string, string> = { ...found };
    if (!confirmed) {
      all.confirmed = 'Confirm that this access is necessary before continuing.';
    }
    setErrors(all);
    if (Object.keys(all).length > 0) return;
    void onSubmit({ orgId, reason, caseRef, scope, minutes });
  };

  return (
    <Modal open={open} onClose={onClose} title="Request support access">
      <div className="space-y-4">
        <div>
          <Label htmlFor="sa-org">Organisation</Label>
          <Select
            id="sa-org"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            aria-invalid={Boolean(errors.orgId)}
          >
            <option value="">Choose an organisation…</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          {errors.orgId && <FieldError message={errors.orgId} />}
        </div>

        <div>
          <Label htmlFor="sa-reason">Support reason</Label>
          <textarea
            id="sa-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Investigating the rota publish failure reported in CASE-2400."
            className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm text-content dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
          />
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            Recorded permanently and visible to the organisation&rsquo;s owner.
          </p>
          {errors.reason && <FieldError message={errors.reason} />}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="sa-case">Case reference</Label>
            <Input
              id="sa-case"
              value={caseRef}
              onChange={(e) => setCaseRef(e.target.value)}
              placeholder="CASE-2400"
            />
            {errors.caseRef && <FieldError message={errors.caseRef} />}
          </div>
          <div>
            <Label htmlFor="sa-duration">Duration</Label>
            <Select
              id="sa-duration"
              value={String(minutes)}
              onChange={(e) => setMinutes(Number(e.target.value))}
            >
              {SUPPORT_ACCESS_DURATIONS.map((d) => (
                <option key={d.minutes} value={d.minutes}>
                  {d.label}
                </option>
              ))}
            </Select>
            {errors.minutes && <FieldError message={errors.minutes} />}
          </div>
        </div>

        <div>
          <Label htmlFor="sa-scope">Access scope</Label>
          <Select
            id="sa-scope"
            value={scope}
            onChange={(e) =>
              setScope(e.target.value === 'read_write' ? 'read_write' : 'read')
            }
          >
            <option value="read">Read only</option>
            <option value="read_write">Read and write</option>
          </Select>
        </div>

        <label className="flex items-start gap-2 text-sm text-content dark:text-content-dark">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1 h-4 w-4 accent-primary"
          />
          <span>
            I confirm that this access is necessary to resolve the identified support
            issue.
          </span>
        </label>
        {errors.confirmed && <FieldError message={errors.confirmed} />}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Opening…' : 'Request access'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function FieldError({ message }: { message: string }): JSX.Element {
  return (
    <p role="alert" className="mt-1 text-xs text-danger">
      {message}
    </p>
  );
}
