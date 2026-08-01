import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { reportError } from '@/lib/sentry';
import type { Announcement } from '@/types';

interface AnnouncementComposerModalProps {
  open: boolean;
  /** Prefills the form — used by "Duplicate" and by the row edit button. */
  seed: Announcement | null;
  onClose: () => void;
  onSubmit: (input: { title: string; body: string; urgent: boolean }) => Promise<void>;
}

/**
 * The "New Announcement" composer behind the header CTA. Posting publishes
 * immediately — `createAnnouncement` sets `published_at` — so there is no
 * schedule field here; scheduling needs a column the schema does not have yet
 * (see `src/lib/announcementsMapping.ts`).
 */
export function AnnouncementComposerModal({
  open,
  seed,
  onClose,
  onSubmit,
}: AnnouncementComposerModalProps): JSX.Element | null {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Re-seed whenever the dialog opens, so "Duplicate" on a second row does not
  // show the first row's text.
  useEffect(() => {
    if (!open) return;
    setTitle(seed ? `${seed.title} (copy)` : '');
    setBody(seed?.body ?? '');
    setUrgent(seed?.urgent ?? false);
  }, [open, seed]);

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !submitting;

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({ title: title.trim(), body: body.trim(), urgent });
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
          Mark as urgent
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
