import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Callout } from '@/components/ui/Callout';
import {
  createDocument,
  deleteDocument,
  listDocuments,
} from '@/services/documentService';
import { reportError } from '@/lib/sentry';
import { useConfirm } from '@/hooks/useConfirm';
import type { StaffDocument } from '@/types';

interface DocumentsModalProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  staffProfileId: string;
  staffName: string;
}

const BLANK = { type: '', name: '', fileUrl: '', issuedAt: '', expiresAt: '' };

/**
 * Add + delete only, no edit. Same call as `EmergencyContactsModal`.
 *
 * `fileUrl` is a plain link field, not a file upload: this repo has no
 * ImageKit (or any storage) integration wired anywhere yet, so a real
 * upload here would be a half-built feature pretending to be finished.
 * A manager pastes a link to wherever the file already lives.
 *
 * The link stays required for now: `documents.file_url` is `not null` with
 * an `https?://` check (`0002`, `0092`), so making it optional needs a
 * migration first.
 */
export function DocumentsModal({
  open,
  onClose,
  orgId,
  staffProfileId,
  staffName,
}: DocumentsModalProps): JSX.Element {
  const { confirm } = useConfirm();
  const [documents, setDocuments] = useState<StaffDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(BLANK);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setDocuments(await listDocuments(orgId, staffProfileId));
    } catch (err) {
      reportError(err, { area: 'staff:documents-load' });
      setError('Could not load documents.');
    } finally {
      setLoading(false);
    }
  }, [orgId, staffProfileId]);

  useEffect(() => {
    if (open) {
      setForm(BLANK);
      setError(null);
      void load();
    }
  }, [open, load]);

  const handleAdd = async (): Promise<void> => {
    if (!form.type.trim() || !form.name.trim() || !form.fileUrl.trim()) return;
    const fileUrl = form.fileUrl.trim();
    // The "Add document" button is type="button" with a direct onClick, not
    // a form submit, so the input's type="url" constraint validation never
    // runs, and even when it does, it accepts any scheme, javascript:
    // included. This is rendered as a real <a href> below, so an
    // unvalidated scheme here is a stored-XSS vector, not just bad data.
    if (!/^https?:\/\//i.test(fileUrl)) {
      setError('Enter a link starting with http:// or https://.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await createDocument({
        staff_profile_id: staffProfileId,
        org_id: orgId,
        type: form.type.trim(),
        name: form.name.trim(),
        file_url: fileUrl,
        issued_at: form.issuedAt || null,
        expires_at: form.expiresAt || null,
      });
      setDocuments((prev) => [...prev, created]);
      setForm(BLANK);
    } catch (err) {
      reportError(err, { area: 'staff:documents-add' });
      setError('Could not add this document. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (doc: StaffDocument): Promise<void> => {
    const ok = await confirm({
      title: 'Remove document record?',
      message: `"${doc.name}" will be removed from this staff member's file. This only removes the record in RotaFlow. The file itself stays wherever it is hosted.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDocument(orgId, doc.id);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      reportError(err, { area: 'staff:documents-delete' });
      setError('Could not remove that document.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Documents, ${staffName}`}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        {loading ? (
          <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
        ) : documents.length === 0 ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            No documents on file yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {documents.map((d) => (
              <li
                key={d.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-surface-border p-3 dark:border-surface-border-dark"
              >
                <div className="min-w-0">
                  <a
                    href={d.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 font-medium text-content hover:text-primary dark:text-primary-ink-dark dark:text-content-dark"
                  >
                    <span className="truncate">{d.name}</span>
                    <ExternalLink size={14} aria-hidden="true" className="shrink-0" />
                  </a>
                  <p className="text-sm text-content-muted dark:text-content-muted-dark">
                    {d.type}
                    {d.expires_at && ` · expires ${d.expires_at}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDelete(d)}
                  aria-label={`Remove ${d.name}`}
                  className="shrink-0 text-content-muted hover:text-danger dark:text-content-muted-dark"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Phase 1 of plan S2 (decision D4). The type field used to suggest
            DBS and right-to-work in its own placeholder, so criminal-record and
            immigration information landed here by design. It no longer
            suggests either, and the copy says what this screen is for: a
            record of the document, not the document. The link is a pointer
            to wherever the file already lives; erasure removes the row and
            cannot touch the file at the other end of it, because nothing in
            this product manages that store. Existing records are untouched. */}
        <Callout tone="warning" title="Before you add a document">
          <p>
            Record the document type, number and expiry. Keep the document itself in your
            own HR system.
          </p>
          <p>
            RotaFlow does not store the file. The link only points at where you keep it,
            and removing the record here, or anonymising the person, does not delete the
            file there.
          </p>
        </Callout>

        <div className="space-y-3 rounded-xl border border-surface-border p-3 dark:border-surface-border-dark">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="doc-type">Type</Label>
              <Input
                id="doc-type"
                value={form.type}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((f) => ({ ...f, type: e.target.value }))
                }
                placeholder="Training certificate, licence…"
              />
            </div>
            <div>
              <Label htmlFor="doc-name">Name or number</Label>
              <Input
                id="doc-name"
                value={form.name}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
          </div>
          <div>
            <Label htmlFor="doc-url">
              Link to where you keep it{' '}
              <span className="text-content-muted dark:text-content-muted-dark">
                (RotaFlow does not store the file)
              </span>
            </Label>
            <Input
              id="doc-url"
              type="url"
              value={form.fileUrl}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setForm((f) => ({ ...f, fileUrl: e.target.value }))
              }
              placeholder="https://…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="doc-issued">Issued</Label>
              <Input
                id="doc-issued"
                type="date"
                value={form.issuedAt}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((f) => ({ ...f, issuedAt: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="doc-expires">Expires</Label>
              <Input
                id="doc-expires"
                type="date"
                value={form.expiresAt}
                min={form.issuedAt || undefined}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((f) => ({ ...f, expiresAt: e.target.value }))
                }
              />
            </div>
          </div>
          {error && (
            <p className="text-sm text-danger-ink dark:text-danger-ink-dark" role="alert">
              {error}
            </p>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleAdd()}
            disabled={
              submitting || !form.type.trim() || !form.name.trim() || !form.fileUrl.trim()
            }
          >
            <Plus size={16} aria-hidden="true" className="mr-1.5" />
            {submitting ? 'Adding…' : 'Add document'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
