import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type ChangeEvent,
  type JSX,
} from 'react';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Callout } from '@/components/ui/Callout';
import {
  deleteDocument,
  documentOpenUrl,
  listDocuments,
  uploadDocument,
} from '@/services/documentService';
import { DOCUMENT_ACCEPT, documentFileProblem } from '@/lib/documentFiles';
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

const BLANK = { type: '', name: '', issuedAt: '', expiresAt: '' };

/**
 * Add + delete only, no edit. Same call as `EmergencyContactsModal`.
 *
 * The file is uploaded to the private `staff-documents` bucket (0159,
 * decision D4) and opened through a signed link that expires a minute after
 * it is asked for. Removing the record, anonymising the person or deleting
 * the organisation queues the file for deletion in the same transaction.
 *
 * Rows from before 0159 hold a pasted link instead. They still open, but a
 * new link can no longer be added: a file somewhere else is a file erasure
 * cannot reach, which is the gap this closed (GAP-056).
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
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      setFile(null);
      setError(null);
      void load();
    }
  }, [open, load]);

  const handleFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const chosen = e.target.files?.[0] ?? null;
    const problem = chosen ? documentFileProblem(chosen) : null;
    setError(problem);
    setFile(problem ? null : chosen);
    if (problem && fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAdd = async (): Promise<void> => {
    if (!form.type.trim() || !form.name.trim() || !file) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await uploadDocument(
        {
          staff_profile_id: staffProfileId,
          org_id: orgId,
          type: form.type.trim(),
          name: form.name.trim(),
          issued_at: form.issuedAt || null,
          expires_at: form.expiresAt || null,
        },
        file,
      );
      setDocuments((prev) => [...prev, created]);
      setForm(BLANK);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      reportError(err, { area: 'staff:documents-add' });
      setError('Could not upload this document. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (doc: StaffDocument): Promise<void> => {
    const ok = await confirm({
      title: 'Remove document record?',
      message: doc.storage_path
        ? `"${doc.name}" and its file will be deleted from this staff member's record.`
        : `"${doc.name}" will be removed from this staff member's file. It was added as a link, so the file itself stays wherever it is hosted.`,
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

  // The window is opened inside the click, before the await, because a
  // window opened after one is treated as a pop-up and blocked. It is then
  // pointed at the signed link once that arrives.
  const handleOpen = async (doc: StaffDocument): Promise<void> => {
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    try {
      const url = await documentOpenUrl(doc);
      if (win) win.location.href = url;
      else window.location.assign(url);
    } catch (err) {
      win?.close();
      reportError(err, { area: 'staff:documents-open' });
      setError('Could not open that document.');
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
                  <button
                    type="button"
                    onClick={() => void handleOpen(d)}
                    className="flex max-w-full items-center gap-1.5 text-left font-medium text-content hover:text-primary dark:text-content-dark dark:hover:text-primary-ink-dark"
                  >
                    <span className="truncate">{d.name}</span>
                    <ExternalLink size={14} aria-hidden="true" className="shrink-0" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </button>
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

        {/* Decision D4. The file is held privately: only this person and the
            organisation's owners and managers can open it, through a link that
            expires in a minute, and it is deleted with the record. The type
            placeholder still does not suggest DBS or right-to-work: what an
            organisation keeps here is its own decision, not a prompt from us. */}
        <Callout tone="info" title="How files are kept">
          <p>
            Files are stored privately. Only this person and your organisation&apos;s
            owners and managers can open them.
          </p>
          <p>
            Removing a document, anonymising the person or deleting the organisation
            deletes the file as well.
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
            <Label htmlFor="doc-file">
              File{' '}
              <span className="text-content-muted dark:text-content-muted-dark">
                (PDF or image, up to 10 MB)
              </span>
            </Label>
            <input
              ref={fileInputRef}
              id="doc-file"
              type="file"
              accept={DOCUMENT_ACCEPT}
              onChange={handleFile}
              className="block w-full text-sm text-content file:mr-3 file:rounded-lg file:border file:border-surface-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-content dark:text-content-dark dark:file:border-surface-border-dark dark:file:bg-surface-dark dark:file:text-content-dark"
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
            disabled={submitting || !form.type.trim() || !form.name.trim() || !file}
          >
            <Plus size={16} aria-hidden="true" className="mr-1.5" />
            {submitting ? 'Uploading…' : 'Add document'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
