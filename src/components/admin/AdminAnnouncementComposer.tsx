import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Callout } from '@/components/ui/Callout';
import { listPlans, type Plan } from '@/services/billingCheckoutService';
import {
  createAnnouncement,
  previewAudience,
  publishAnnouncement,
} from '@/services/platformAnnouncementService';
import { reportError } from '@/lib/sentry';

/**
 * Compose a platform announcement.
 *
 * ## Why this did not exist
 *
 * `/admin/notifications` disabled its New announcement button with the title
 * "There is no announcement table to write to", on a screen that was at that
 * moment listing rows from `platform_announcements`. The table, the
 * `create_platform_announcement` RPC and the `publish_platform_announcement`
 * fan-out all shipped in `0025`; the service wrapping them had no caller. The
 * claim was two migrations out of date and the button it disabled was the only
 * way in.
 *
 * ## What the three buttons actually do
 *
 * **Save draft** writes the row and nothing else. **Schedule** writes it with
 * a time, and `publish_due_platform_announcements()` (0132) publishes it on
 * the next minute tick — a real job, not a stored timestamp. **Publish now**
 * resolves the audience into a delivery row per organisation and queues a
 * dispatch for each through `notification_outbox`, the queue that has been
 * draining rota publications since `0069`.
 *
 * None of the three says "delivered". Publishing queues; a delivery becomes
 * sent when the dispatch is confirmed, and the register shows queued,
 * delivered and failed as three separate columns because they are three
 * separate facts.
 */

const KINDS = [
  { value: 'maintenance', label: 'Maintenance window' },
  { value: 'incident', label: 'Incident' },
  { value: 'product', label: 'Product update' },
  { value: 'billing', label: 'Billing' },
  { value: 'policy', label: 'Policy change' },
] as const;

/**
 * `in_app` only, and the reason is worth stating rather than hiding behind a
 * disabled option.
 *
 * `send-notification` writes the in-app row and then attempts push and email
 * under each organisation's own settings, so one dispatch already reaches
 * every channel that organisation has switched on. The column's other two
 * values would let this form claim to choose a channel it does not control —
 * the recipient's settings decide that, as they should.
 */
const CHANNEL = 'in_app';

export interface AnnouncementComposerResult {
  id: string;
  /** How many organisations were addressed. Queued, not delivered. */
  queuedTo: number | null;
  status: 'draft' | 'scheduled' | 'sent';
  title: string;
}

export function AdminAnnouncementComposer({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (result: AnnouncementComposerResult) => void;
}): JSX.Element {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<string>('product');
  const [audience, setAudience] = useState<'all' | 'plans'>('all');
  const [selectedPlans, setSelectedPlans] = useState<string[]>([]);
  const [scheduledFor, setScheduledFor] = useState('');
  const [reach, setReach] = useState<number | null>(null);
  const [reachFailed, setReachFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Reopening must not show the previous attempt's values or errors.
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setBody('');
    setKind('product');
    setAudience('all');
    setSelectedPlans([]);
    setScheduledFor('');
    setFormError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      try {
        const rows = await listPlans();
        if (active) setPlans(rows);
      } catch (err) {
        reportError(err, { area: 'admin:announce:plans' });
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  /**
   * The recipient count, recomputed whenever the audience changes.
   *
   * Shown before publishing rather than after, because "sent to 96
   * organisations" is not a number anybody wants to meet for the first time
   * afterwards. It counts the audience, not the delivery: an organisation
   * with no active owner or manager is in this number and will be recorded as
   * a failed delivery, which is a recipient nobody can reach rather than one
   * nobody chose.
   */
  useEffect(() => {
    if (!open) return;
    let active = true;
    setReachFailed(false);
    setReach(null);
    void (async () => {
      try {
        const count = await previewAudience({ audience, plans: selectedPlans, kind });
        if (active) setReach(count);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:announce:preview' });
        setReachFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, audience, selectedPlans, kind]);

  const validate = useCallback(
    (requireSchedule: boolean): string | null => {
      if (title.trim() === '') return 'Give the announcement a title.';
      if (body.trim() === '') return 'Write the message.';
      if (audience === 'plans' && selectedPlans.length === 0) {
        return 'Choose at least one plan, or address every organisation.';
      }
      if (requireSchedule) {
        if (scheduledFor === '') return 'Choose when it should go out.';
        const at = new Date(scheduledFor);
        if (Number.isNaN(at.getTime())) return 'That is not a valid date and time.';
        // A time in the past would publish on the next minute tick, which is
        // "now" wearing a schedule. If that is what is wanted, Publish now
        // says so honestly.
        if (at.getTime() <= Date.now()) {
          return 'That time has passed. Use Publish now, or choose a future time.';
        }
      }
      return null;
    },
    [title, body, audience, selectedPlans, scheduledFor],
  );

  const submit = useCallback(
    async (mode: 'draft' | 'schedule' | 'publish'): Promise<void> => {
      const problem = validate(mode === 'schedule');
      if (problem) {
        setFormError(problem);
        return;
      }

      setSubmitting(true);
      setFormError(null);
      try {
        const id = await createAnnouncement({
          title: title.trim(),
          body: body.trim(),
          kind,
          audience,
          plans: audience === 'plans' ? selectedPlans : [],
          channel: CHANNEL,
          // The picker is a local datetime; the database stores an instant.
          // `toISOString()` is what converts one to the other, and doing it
          // here rather than in the service keeps the timezone question where
          // the person chose the time.
          scheduledFor: mode === 'schedule' ? new Date(scheduledFor).toISOString() : null,
        });

        if (mode === 'publish') {
          const queuedTo = await publishAnnouncement(id);
          onDone({ id, queuedTo, status: 'sent', title: title.trim() });
          return;
        }

        onDone({
          id,
          queuedTo: null,
          status: mode === 'schedule' ? 'scheduled' : 'draft',
          title: title.trim(),
        });
      } catch (err) {
        reportError(err, { area: `admin:announce:${mode}` });
        setFormError(
          err instanceof Error && err.message
            ? err.message
            : 'Could not save that announcement.',
        );
      } finally {
        setSubmitting(false);
      }
    },
    [validate, title, body, kind, audience, selectedPlans, scheduledFor, onDone],
  );

  const ignoresOptOut = kind === 'maintenance' || kind === 'incident';

  return (
    <Modal open={open} onClose={onClose} title="New announcement">
      <div className="space-y-4">
        <div>
          <Label htmlFor="announce-title">Title</Label>
          <Input
            id="announce-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Planned maintenance, Sunday 02:00–02:30"
            maxLength={120}
          />
        </div>

        <div>
          <Label htmlFor="announce-body">Message</Label>
          <textarea
            id="announce-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder="What is happening, when, and what it means for the customer."
            className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="announce-kind">Type</Label>
            <Select
              id="announce-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {KINDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="announce-audience">Audience</Label>
            <Select
              id="announce-audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value === 'plans' ? 'plans' : 'all')}
            >
              <option value="all">Every active organisation</option>
              <option value="plans">Chosen plans only</option>
            </Select>
          </div>
        </div>

        {audience === 'plans' && (
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-content dark:text-content-dark">
              Plans
            </legend>
            <div className="flex flex-wrap gap-3">
              {plans.map((plan) => (
                <label
                  key={plan.code}
                  className="flex items-center gap-2 text-sm text-content dark:text-content-dark"
                >
                  <input
                    type="checkbox"
                    checked={selectedPlans.includes(plan.code)}
                    onChange={(e) =>
                      setSelectedPlans((current) =>
                        e.target.checked
                          ? [...current, plan.code]
                          : current.filter((code) => code !== plan.code),
                      )
                    }
                    className="h-4 w-4 rounded border-surface-border text-primary focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
                  />
                  {plan.name}
                </label>
              ))}
              {plans.length === 0 && (
                <p className="text-sm text-content-muted dark:text-content-muted-dark">
                  The plan list could not be loaded.
                </p>
              )}
            </div>
          </fieldset>
        )}

        <div>
          <Label htmlFor="announce-when">Schedule for (optional)</Label>
          <Input
            id="announce-when"
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
          />
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            In this browser&rsquo;s timezone. A scheduled announcement is published by a
            job that runs every minute, so it goes out within a minute of the time you
            choose.
          </p>
        </div>

        <Callout tone="info" title="Who this reaches">
          <p className="text-sm leading-relaxed">
            {reachFailed
              ? 'The recipient count could not be read, so this will not say how many organisations it reaches. Publishing still works; the register afterwards shows exactly who was addressed.'
              : reach === null
                ? 'Counting the audience…'
                : `${reach.toLocaleString('en-GB')} active ${reach === 1 ? 'organisation' : 'organisations'}. Each one's owners and managers are notified, not everybody on their rota.`}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed">
            {ignoresOptOut
              ? 'Maintenance and incident notices ignore an opt-out: they are operational rather than optional.'
              : 'Organisations that have opted out of non-essential platform mail are excluded from this count and will not be addressed.'}
          </p>
        </Callout>

        {formError && (
          <p
            role="alert"
            className="rounded-xl bg-danger-wash px-3 py-2 text-sm text-danger-ink dark:bg-danger-wash-dark dark:text-danger-ink-dark"
          >
            {formError}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => void submit('draft')}
            disabled={submitting}
          >
            Save draft
          </Button>
          <Button
            variant="secondary"
            onClick={() => void submit('schedule')}
            disabled={submitting || scheduledFor === ''}
            title={
              scheduledFor === '' ? 'Choose a time above to schedule this' : undefined
            }
          >
            Schedule
          </Button>
          <Button onClick={() => void submit('publish')} disabled={submitting}>
            {submitting ? 'Working…' : 'Publish now'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
