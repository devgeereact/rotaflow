import { useCallback, useState } from 'react';
import { Info, MessageSquarePlus, ShieldCheck } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { openSupportCase } from '@/services/supportCaseService';
import { reportError } from '@/lib/sentry';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';

const QUESTIONS: { q: string; a: string }[] = [
  {
    q: 'Why can’t I publish the rota?',
    a: 'A day is below minimum cover, or someone breaks the minimum rest rule. Check the Conflicts card in the Rota Builder.',
  },
  {
    q: 'A shift is missing from my schedule',
    a: 'The week may still be a draft. A draft rota is not visible to staff until a manager publishes it.',
  },
  {
    q: 'I clocked in but nothing happened',
    a: 'You were offline. The entry is queued on your device and syncs the next time you have a connection.',
  },
  {
    q: 'My hours look wrong',
    a: 'Timesheets come from clock events, not the plan. Ask a manager to amend a clock time if it is wrong.',
  },
];

/**
 * `/app/help` (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.help`).
 *
 * Did not exist before this screen: the sidebar's "Help & Support" link sent
 * a signed-in user out of the app shell entirely, to the public marketing
 * contact page. "Contact support" here calls `openSupportCase` (0024's
 * `support_cases`/`open_support_case`), which already existed for the
 * platform console's queue but had no requester-facing door into it.
 */
export function HelpPage(): JSX.Element {
  const { orgId, orgName } = useOrg();
  const { user } = useSupabaseAuth();
  const { showError, showSuccess } = useToast();

  const [contactOpen, setContactOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      await openSupportCase({
        subject: `Help request from ${orgName ?? 'the app'}`,
        body: message.trim(),
        category: 'question',
        orgId,
        requesterEmail: user?.email ?? null,
      });
      showSuccess('Message sent. Support replies within one working day.');
      setMessage('');
      setContactOpen(false);
    } catch (err) {
      reportError(err, { area: 'help:contact-support' });
      showError('Could not send that message. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [message, orgName, orgId, user, showError, showSuccess]);

  // Separate from "Contact support": that path is for something wrong that
  // needs a reply. This is for a thought that doesn't — a suggestion, a
  // rough edge, a "why doesn't it just...". Same underlying mechanism
  // (`open_support_case`), category `feature` so it lands distinctly from a
  // help request in the queue, and a lighter-touch form: no modal, no
  // required back-and-forth, just a box and a button.
  const [feedback, setFeedback] = useState('');
  const [sendingFeedback, setSendingFeedback] = useState(false);

  const handleFeedbackSubmit = useCallback(async (): Promise<void> => {
    if (!feedback.trim()) return;
    setSendingFeedback(true);
    try {
      await openSupportCase({
        subject: `Feedback from ${orgName ?? 'the app'}`,
        body: feedback.trim(),
        category: 'feature',
        priority: 'low',
        orgId,
        requesterEmail: user?.email ?? null,
      });
      showSuccess('Thanks — that goes straight to the team building this.');
      setFeedback('');
    } catch (err) {
      reportError(err, { area: 'help:feedback' });
      showError('Could not send that. Please try again.');
    } finally {
      setSendingFeedback(false);
    }
  }, [feedback, orgName, orgId, user, showError, showSuccess]);

  return (
    <div>
      <WorkspaceHeader
        title="Help & support"
        subtitle="Answers first, a person second."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="border-b border-surface-border p-4 dark:border-surface-border-dark">
            <h2 className="font-semibold text-content dark:text-content-dark">
              Common questions
            </h2>
          </div>
          <ul>
            {QUESTIONS.map(({ q, a }) => (
              <li
                key={q}
                className="flex gap-3 border-b border-surface-border p-4 last:border-0 dark:border-surface-border-dark"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-info/10 text-info">
                  <Info size={15} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-content dark:text-content-dark">
                    {q}
                  </span>
                  <span className="mt-0.5 block text-sm text-content-muted dark:text-content-muted-dark">
                    {a}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck size={18} className="text-primary" aria-hidden="true" />
              <h2 className="font-semibold text-content dark:text-content-dark">
                Still stuck
              </h2>
            </div>
            <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
              Support can, with your permission, open a time-limited read-only session
              against {orgName ?? 'your organisation'}. You are told when that happens, it
              expires on its own, and every action taken is recorded in your organisation
              audit log.
            </p>
            <Button onClick={() => setContactOpen(true)}>Contact support</Button>
          </Card>

          <Card>
            <div className="mb-3 flex items-center gap-2">
              <MessageSquarePlus size={18} className="text-primary" aria-hidden="true" />
              <h2 className="font-semibold text-content dark:text-content-dark">
                Got a thought?
              </h2>
            </div>
            <p className="mb-3 text-sm text-content-muted dark:text-content-muted-dark">
              Not stuck, just an idea, a rough edge, or a &ldquo;why doesn&rsquo;t it just
              &hellip;&rdquo;. This goes straight to the team building RotaFlow, no reply
              expected.
            </p>
            <Label htmlFor="help-feedback" className="sr-only">
              Your feedback
            </Label>
            <textarea
              id="help-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              placeholder="Tell us what's on your mind…"
              className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
            />
            <Button
              className="mt-3"
              variant="secondary"
              disabled={sendingFeedback || !feedback.trim()}
              onClick={() => void handleFeedbackSubmit()}
            >
              {sendingFeedback ? 'Sending…' : 'Send feedback'}
            </Button>
          </Card>
        </div>
      </div>

      <Modal
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        title="Contact support"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="help-message">What is happening?</Label>
            <textarea
              id="help-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setContactOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={submitting || !message.trim()}
              onClick={() => void handleSubmit()}
            >
              {submitting ? 'Sending…' : 'Send message'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
