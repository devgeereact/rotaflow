import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import {
  createDocument,
  deleteDocument,
  listDocuments,
} from '@/services/documentService';
import { reportError } from '@/lib/sentry';
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
 * Add + delete only, no edit — same call as `EmergencyContactsModal`.
 *
 * `fileUrl` is a plain link field, not a file upload: this repo has no
 * ImageKit (or any storage) integration wired anywhere yet, so a real
 * upload here would be a half-built feature pretending to be finished.
 * A manager pastes a link to wherever the file already lives.
 */
export function DocumentsModal({
  open,
  onClose,
  orgId,
  staffProfileId,
  staffName,
}: DocumentsModalProps): JSX.Element {
  const [documents, setDocuments] = useState<StaffDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(BLANK);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setDocuments(await listDocuments(staffProfileId));
    } catch (err) {
      reportError(err, { area: 'staff:documents-load' });
      setError('Could not load documents.');
    } finally {
      setLoading(false);
    }
  }, [staffProfileId]);

  useEffect(() => {
    if (open) {
      setForm(BLANK);
      setError(null);
      void load();
    }
  }, [open, load]);

  const handleAdd = async (): Promise<void> => {
    if (!form.type.trim() || !form.name.trim() || !form.fileUrl.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createDocument({
        staff_profile_id: staffProfileId,
        org_id: orgId,
        type: form.type.trim(),
        name: form.name.trim(),
        file_url: form.fileUrl.trim(),
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
    if (
      !window.confirm(
        `Remove "${doc.name}"? This only removes the record — not the file itself.`,
      )
    )
      return;
    try {
      await deleteDocument(doc.id);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      reportError(err, { area: 'staff:documents-delete' });
      setError('Could not remove that document.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Documents — ${staffName}`}>
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
                    className="flex items-center gap-1.5 font-medium text-content hover:text-primary dark:text-content-dark"
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
                placeholder="DBS check, Right to work…"
              />
            </div>
            <div>
              <Label htmlFor="doc-name">Name</Label>
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
            <Label htmlFor="doc-url">Link to the file</Label>
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
            <p className="text-sm text-danger" role="alert">
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
