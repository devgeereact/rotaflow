import { useEffect, useState } from 'react';
import { Send, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { reportError } from '@/lib/sentry';
import { draftAnnouncement } from '@/services/aiRotaService';
import type { Department, Location } from '@/types';

export interface AnnouncementDraft {
  title: string;
  body: string;
  urgent: boolean;
  audience: string;
}

interface AnnouncementComposerModalProps {
  open: boolean;
  locations: Location[];
  departments: Department[];
  /** Enables AI drafting. Omitted for anyone who cannot manage the org. */
  orgId?: string | null;
  onClose: () => void;
  onSubmit: (input: AnnouncementDraft) => Promise<void>;
}

/** Encodes an audience choice as `org` | `location:<id>` | `department:<id>`. */
const ALL_SITES = 'org';

function draftPeriod(): { periodStart: string; periodEnd: string } {
  const today = new Date();
  const end = new Date(today);
  end.setDate(today.getDate() + 14);
  return {
    periodStart: today.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

/**
 * `SCREENS.announcements`'s "New announcement" dialog (Title/Audience/
 * Message). Posting publishes immediately, `createAnnouncement` sets
 * `published_at`, so there is no schedule field here. AI drafting is a real,
 * additive capability beyond the reference (see `draftAnnouncement`); "Pin
 * this announcement" reuses the real `urgent` column rather than inventing a
 * pin column the schema does not have.
 */
export function AnnouncementComposerModal({
  open,
  locations,
  departments,
  orgId,
  onClose,
  onSubmit,
}: AnnouncementComposerModalProps): JSX.Element | null {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [audience, setAudience] = useState(ALL_SITES);
  const [submitting, setSubmitting] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setBody('');
    setUrgent(false);
    setAudience(ALL_SITES);
    setAiPrompt('');
    setAiNote(null);
    setAiError(null);
  }, [open]);

  const handleDraft = async (): Promise<void> => {
    if (!orgId || !aiPrompt.trim()) return;
    setDrafting(true);
    setAiError(null);
    setAiNote(null);
    try {
      const draft = await draftAnnouncement({
        orgId,
        prompt: aiPrompt.trim(),
        ...draftPeriod(),
      });
      setTitle(draft.title);
      setBody(draft.body);
      setUrgent(draft.urgent);
      setAiNote(draft.reasoning || 'Draft ready. Read it through before posting.');
    } catch (err) {
      reportError(err, { area: 'announcements:ai-draft' });
      setAiError(
        'AI drafting is unavailable right now. Write the announcement below as normal.',
      );
    } finally {
      setDrafting(false);
    }
  };

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !submitting;

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({ title: title.trim(), body: body.trim(), urgent, audience });
      onClose();
    } catch (err) {
      reportError(err, { area: 'announcements:create' });
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="New announcement">
      <div className="space-y-4">
        {orgId && (
          <div className="rounded-xl border border-surface-border bg-surface-subtle p-3 dark:border-surface-border-dark dark:bg-surface-subtle-dark">
            <Label htmlFor="ann-ai">Draft it with AI</Label>
            <div className="flex gap-2">
              <Input
                id="ann-ai"
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                placeholder="e.g. Ask for cover on the unfilled weekend nights"
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={drafting || !aiPrompt.trim()}
                onClick={() => void handleDraft()}
              >
                <Wand2 size={15} aria-hidden="true" />
                {drafting ? 'Drafting…' : 'Draft'}
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-content-muted dark:text-content-muted-dark">
              Grounded in the next fortnight&rsquo;s real rota. It fills the form below.
              Nothing is posted until you press Post.
            </p>
            {aiNote && (
              <p className="mt-1.5 text-xs text-success" role="status">
                {aiNote}
              </p>
            )}
            {aiError && (
              <p className="mt-1.5 text-xs text-warning" role="status">
                {aiError}
              </p>
            )}
          </div>
        )}

        <div>
          <Label htmlFor="ann-title">Title</Label>
          <Input
            id="ann-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Staff meeting this Friday"
          />
        </div>
        <div>
          <Label htmlFor="ann-audience">Audience</Label>
          <Select
            id="ann-audience"
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
          >
            <option value={ALL_SITES}>All sites</option>
            {locations.map((l) => (
              <option key={l.id} value={`location:${l.id}`}>
                {l.name}
              </option>
            ))}
            {departments.map((d) => (
              <option key={d.id} value={`department:${d.id}`}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ann-body">Message</Label>
          <textarea
            id="ann-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={5}
            placeholder="Details for your team…"
            className="w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-content dark:text-content-dark">
          <input
            type="checkbox"
            checked={urgent}
            onChange={(event) => setUrgent(event.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Pin this announcement
        </label>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={() => void handleSubmit()}>
            <Send size={15} aria-hidden="true" />
            {submitting ? 'Posting…' : 'Post announcement'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
