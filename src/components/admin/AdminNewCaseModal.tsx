import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { openSupportCase } from '@/services/supportCaseService';
import { listOrganisationDirectoryAll } from '@/services/platformDirectoryService';
import { isValidEmail } from '@/lib/email';
import { reportError } from '@/lib/sentry';

/**
 * Raise a case on a customer's behalf.
 *
 * ## Why the button was disabled, and why that was wrong
 *
 * "Cases arrive from customers; opening one on their behalf is not built yet."
 * The first half is usually true and the second half was not: `0024`'s
 * `open_support_case` has an explicit branch for this —
 *
 *     -- Platform staff may raise a case on a tenant's behalf and name the
 *     -- address it came from. A customer may not: they are the requester.
 *
 * — and it has been there since the table was created. The RPC records the
 * platform administrator as the author, stamps the customer's address as the
 * requester, and writes the opening message with `author_side = 'platform'`,
 * so the trail says plainly that support opened it rather than the customer.
 *
 * The case somebody actually needs this for is the phone call: a customer
 * rings, and without this the conversation has no record at all.
 */

const CATEGORIES = [
  { value: 'question', label: 'Question' },
  { value: 'bug', label: 'Bug' },
  { value: 'billing', label: 'Billing' },
  { value: 'feature', label: 'Feature request' },
  { value: 'incident', label: 'Incident' },
  { value: 'access', label: 'Access' },
] as const;

const PRIORITIES = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
] as const;

export function AdminNewCaseModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (caseId: string, subject: string) => void;
}): JSX.Element {
  const [organisations, setOrganisations] = useState<{ id: string; name: string }[]>([]);
  const [orgId, setOrgId] = useState('');
  const [requesterEmail, setRequesterEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<string>('question');
  const [priority, setPriority] = useState<string>('normal');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setOrgId('');
    setRequesterEmail('');
    setSubject('');
    setBody('');
    setCategory('question');
    setPriority('normal');
    setFormError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      try {
        const all = await listOrganisationDirectoryAll({ pageSize: 200 });
        if (!active) return;
        setOrganisations(all.rows.map((row) => ({ id: row.id, name: row.name })));
      } catch (err) {
        reportError(err, { area: 'admin:new-case:organisations' });
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  const submit = useCallback(async (): Promise<void> => {
    if (subject.trim() === '') {
      setFormError('Give the case a subject.');
      return;
    }
    if (body.trim() === '') {
      setFormError('Write down what the customer reported.');
      return;
    }
    // Optional, but a malformed one is refused by the table's own CHECK, and
    // a 23514 in a toast is a worse way to learn that.
    if (requesterEmail.trim() !== '' && !isValidEmail(requesterEmail.trim())) {
      setFormError('That does not look like a valid email address.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const id = await openSupportCase({
        subject: subject.trim(),
        body: body.trim(),
        category,
        priority,
        orgId: orgId === '' ? null : orgId,
        requesterEmail: requesterEmail.trim() === '' ? null : requesterEmail.trim(),
      });
      onCreated(id, subject.trim());
    } catch (err) {
      reportError(err, { area: 'admin:new-case:submit' });
      setFormError(
        err instanceof Error && err.message ? err.message : 'Could not open that case.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [subject, body, requesterEmail, category, priority, orgId, onCreated]);

  return (
    <Modal open={open} onClose={onClose} title="Open a case on a customer's behalf">
      <div className="space-y-4">
        <div>
          <Label htmlFor="case-org">Organisation</Label>
          <Select id="case-org" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">No organisation (a general enquiry)</option>
            {organisations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="case-email">Customer&rsquo;s email</Label>
          <Input
            id="case-email"
            type="email"
            value={requesterEmail}
            onChange={(e) => setRequesterEmail(e.target.value)}
            placeholder="name@customer.example"
          />
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            Recorded as the requester so replies reach the person who rang. Leave it empty
            and the case is attributed to you.
          </p>
        </div>

        <div>
          <Label htmlFor="case-subject">Subject</Label>
          <Input
            id="case-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Cannot publish next week's rota"
            maxLength={140}
          />
        </div>

        <div>
          <Label htmlFor="case-body">What they reported</Label>
          <textarea
            id="case-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder="In their words where you have them. This becomes the first message on the case."
            className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="case-category">Category</Label>
            <Select
              id="case-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="case-priority">Priority</Label>
            <Select
              id="case-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {PRIORITIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
              Priority starts the response clock. It does not pause while waiting on the
              customer.
            </p>
          </div>
        </div>

        {formError && (
          <p
            role="alert"
            className="rounded-xl bg-danger-wash px-3 py-2 text-sm text-danger-ink dark:bg-danger-wash-dark dark:text-danger-ink-dark"
          >
            {formError}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? 'Opening…' : 'Open case'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
