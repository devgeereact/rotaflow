import { useCallback, useEffect, useState } from 'react';
import { Info, MessageSquarePlus, ShieldCheck, Star } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import {
  listCaseMessages,
  listMyCases,
  openSupportCase,
  rateCase,
  replyToCase,
  type SupportCase,
  type SupportCaseMessage,
} from '@/services/supportCaseService';
import { reportError } from '@/lib/sentry';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
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

const STATUS_TONE: Record<string, BadgeTone> = {
  open: 'info',
  pending: 'warning',
  on_hold: 'neutral',
  resolved: 'success',
  closed: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  pending: 'Awaiting support',
  on_hold: 'On hold',
  resolved: 'Resolved',
  closed: 'Closed',
};

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

  // BUG-060: `rate_support_case` shipped in 0024 and had no caller, so
  // `support_cases.csat` could never be anything but null and the console's
  // CSAT figure could never be anything but "no data". Rating needs somewhere
  // to rate FROM, so this is also the first place a requester can see what
  // happened to a request after they sent it.
  const [myCases, setMyCases] = useState<SupportCase[]>([]);
  const [casesReloadKey, setCasesReloadKey] = useState(0);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [thread, setThread] = useState<SupportCaseMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [rating, setRating] = useState<string | null>(null);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;
    let active = true;
    void listMyCases(userId)
      .then((rows) => {
        if (active) setMyCases(rows);
      })
      .catch((err) => {
        // Not fatal to the page. Help still has to work when the case list
        // does not — its main job is letting someone ask for help.
        reportError(err, { area: 'help:my-cases' });
      });
    return () => {
      active = false;
    };
  }, [user?.id, casesReloadKey]);

  const toggleCase = useCallback(
    (caseId: string): void => {
      if (openCaseId === caseId) {
        setOpenCaseId(null);
        return;
      }
      setOpenCaseId(caseId);
      setThread([]);
      // One draft, and only one case open at a time — so it has to be cleared
      // on the switch. Carrying it across would offer a reply written about
      // one case, pre-filled under another, one click from being sent there.
      setReply('');
      setThreadLoading(true);
      // Internal notes are excluded by the RLS policy itself (0024), not by a
      // filter here — a client-side one is a single forgotten `.eq()` away
      // from showing a customer what the team said about them.
      void listCaseMessages(caseId)
        .then(setThread)
        .catch((err) => {
          reportError(err, { area: 'help:case-thread' });
          showError('Could not load that conversation.');
        })
        .finally(() => setThreadLoading(false));
    },
    [openCaseId, showError],
  );

  // GAP-012's remaining half. `reply_to_support_case` has been in the schema
  // since 0024, granted to `authenticated`, and it already decides who may
  // write: the requester or an owner of the case's organisation, and never an
  // internal note. Only `/admin` ever called it, so a customer could read the
  // thread and not answer it — support could ask a question the person it was
  // addressed to had no way to answer, in the product. Nothing new is trusted
  // to the client here; the guard was always in the function.
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);

  const handleReply = useCallback(
    async (caseId: string): Promise<void> => {
      const body = reply.trim();
      if (!body) return;
      setReplying(true);
      try {
        await replyToCase(caseId, body);
        setReply('');
        // Re-read rather than appending optimistically: the reply is stamped
        // and named by the database, and a locally-built row would be the one
        // message in the thread whose author and time this screen guessed.
        setThread(await listCaseMessages(caseId));
        // The case list carries the SLA state, which a reply can move.
        setCasesReloadKey((k) => k + 1);
      } catch (err) {
        reportError(err, { area: 'help:reply-case' });
        showError('Could not send that reply. Please try again.');
      } finally {
        setReplying(false);
      }
    },
    [reply, showError],
  );

  const handleRate = useCallback(
    async (caseId: string, score: number): Promise<void> => {
      setRating(caseId);
      try {
        await rateCase(caseId, score);
        setCasesReloadKey((k) => k + 1);
        showSuccess('Thank you — that helps us see where support is falling short.');
      } catch (err) {
        reportError(err, { area: 'help:rate-case' });
        showError('Could not save that rating. Please try again.');
      } finally {
        setRating(null);
      }
    },
    [showError, showSuccess],
  );
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
      // So it appears in "Your requests" immediately, rather than the next
      // time the page happens to mount.
      setCasesReloadKey((k) => k + 1);
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
      setCasesReloadKey((k) => k + 1);
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
              <ShieldCheck
                size={18}
                className="text-primary dark:text-primary-ink-dark"
                aria-hidden="true"
              />
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
              <MessageSquarePlus
                size={18}
                className="text-primary dark:text-primary-ink-dark"
                aria-hidden="true"
              />
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

      {myCases.length > 0 && (
        <Card className="mt-4 p-0">
          <div className="border-b border-surface-border p-4 dark:border-surface-border-dark">
            <h2 className="font-semibold text-content dark:text-content-dark">
              Your requests
            </h2>
            <p className="mt-0.5 text-sm text-content-muted dark:text-content-muted-dark">
              What you have asked us, and what happened next. Internal notes stay internal
              — the database excludes them, not this screen.
            </p>
          </div>
          <ul>
            {myCases.map((row) => {
              const expanded = openCaseId === row.id;
              return (
                <li
                  key={row.id}
                  className="border-b border-surface-border last:border-0 dark:border-surface-border-dark"
                >
                  <button
                    type="button"
                    onClick={() => toggleCase(row.id)}
                    aria-expanded={expanded}
                    className="flex w-full flex-wrap items-center gap-2.5 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="font-mono text-xs text-content-muted dark:text-content-muted-dark">
                      {row.reference}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-content dark:text-content-dark">
                      {row.subject}
                    </span>
                    <Badge tone={STATUS_TONE[row.status] ?? 'neutral'} dot>
                      {STATUS_LABEL[row.status] ?? row.status}
                    </Badge>
                  </button>

                  {expanded && (
                    <div className="px-4 pb-4">
                      {threadLoading ? (
                        <p className="text-sm text-content-muted dark:text-content-muted-dark">
                          Loading…
                        </p>
                      ) : thread.length === 0 ? (
                        <p className="text-sm text-content-muted dark:text-content-muted-dark">
                          No replies yet.
                        </p>
                      ) : (
                        <ul className="space-y-3">
                          {thread.map((msg) => (
                            <li
                              key={msg.id}
                              className="rounded-lg border border-surface-border p-3 dark:border-surface-border-dark"
                            >
                              {/* `author_side` is `'customer' | 'platform'`
                                  (0024's CHECK). This read `'agent'`, a value
                                  the column cannot hold, so the branch never
                                  fired: every support reply was labelled with
                                  the support agent's own full name instead of
                                  "Support" — a staff member's name shown to a
                                  customer who never asked for it, and no
                                  indication the reply came from us at all. */}
                              <span className="block text-xs font-medium text-content-muted dark:text-content-muted-dark">
                                {msg.author_side === 'platform'
                                  ? 'Support'
                                  : (msg.author_name ?? 'You')}
                                {' · '}
                                {new Date(msg.created_at).toLocaleString('en-GB')}
                              </span>
                              <span className="mt-1 block whitespace-pre-wrap text-sm text-content dark:text-content-dark">
                                {msg.body}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* Not on a closed case. `reply_to_support_case` would
                          accept one, but a closed case is the one state where
                          nobody is watching the queue, so a box here would
                          take a message and quietly strand it. Resolved is
                          different — a person can still say "this is not
                          fixed", and that reply is exactly the signal support
                          needs before the case closes for good. */}
                      {row.status !== 'closed' && (
                        <div className="mt-4 border-t border-surface-border pt-3 dark:border-surface-border-dark">
                          <Label htmlFor={`reply-${row.id}`}>Reply to support</Label>
                          <textarea
                            id={`reply-${row.id}`}
                            value={reply}
                            onChange={(e) => setReply(e.target.value)}
                            rows={3}
                            className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
                          />
                          <div className="mt-2 flex justify-end">
                            <Button
                              disabled={replying || !reply.trim()}
                              onClick={() => void handleReply(row.id)}
                            >
                              {replying ? 'Sending…' : 'Send reply'}
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Only on a resolved case, because `rate_support_case`
                          refuses before resolution (0024) — offering the
                          control earlier would be a button that errors. */}
                      {row.resolved_at !== null && (
                        <div className="mt-4 border-t border-surface-border pt-3 dark:border-surface-border-dark">
                          <span className="block text-sm font-medium text-content dark:text-content-dark">
                            {row.csat === null
                              ? 'How did we do?'
                              : 'Your rating. Change it if you like'}
                          </span>
                          <div className="mt-2 flex gap-1.5">
                            {[1, 2, 3, 4, 5].map((score) => {
                              const chosen = row.csat !== null && score <= row.csat;
                              return (
                                <button
                                  key={score}
                                  type="button"
                                  disabled={rating === row.id}
                                  onClick={() => void handleRate(row.id, score)}
                                  aria-label={`Rate ${score} out of 5`}
                                  aria-pressed={row.csat === score}
                                  className="grid h-11 w-11 place-items-center rounded-lg text-content-muted hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
                                >
                                  {/* Fill is `warning`, stroke is
                                      `warning-ink`. `warning.DEFAULT` is
                                      2.27:1 on white — tailwind.config.ts says
                                      so in its own comment — and a control
                                      carrying meaning needs 3:1 under WCAG
                                      1.4.11, so the shape is drawn in the ink
                                      token. Filled-vs-outline is a non-colour
                                      cue as well, and `aria-pressed` carries
                                      it for anyone not looking. */}
                                  <Star
                                    size={20}
                                    aria-hidden="true"
                                    className={
                                      chosen
                                        ? 'fill-warning text-warning-ink dark:text-warning-ink-dark'
                                        : undefined
                                    }
                                  />
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

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
