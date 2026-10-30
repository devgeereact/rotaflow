import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type JSX,
} from 'react';
import { ExternalLink, Plus, Send, Undo2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import {
  documentOpenUrl,
  listDocumentTypes,
  listDocuments,
  submitDocument,
  uploadDocument,
  withdrawDocument,
} from '@/services/documentService';
import {
  allowedActions,
  STATUS_LABELS,
  statusTone,
  type DocumentType,
} from '@/lib/compliance';
import { DOCUMENT_ACCEPT, documentFileProblem } from '@/lib/documentFiles';
import { ApiError } from '@/lib/api';
import { reportError } from '@/lib/sentry';
import { useConfirm } from '@/hooks/useConfirm';
import type { StaffDocument } from '@/types';

interface DocumentsModalProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  staffProfileId: string;
  staffName: string;
  /** Owners and managers: may also withdraw an approved document. Review happens on the Compliance page. */
  canManage?: boolean;
  /** Called after any change, so a page showing counts can reload them. */
  onChanged?: () => void;
  /** Overrides "Documents, <name>" (the person's own view says "Your documents"). */
  title?: string;
}

const BLANK = { typeId: '', name: '', issuedAt: '', expiresAt: '', submit: true };

/** The API's sentence when it has one (it says what to fix), else a plain fallback. */
function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

/**
 * A person's documents (compliance, slice S10). An upload is chosen against one of the
 * organisation's document types and waits for an owner or manager to approve it: until then it
 * does not count. Replacing a document adds a row; the earlier one is kept as history.
 *
 * The file is held in the private store, opened through a link that lasts a minute, and deleted
 * when the person is erased or the organisation is deleted.
 */
export function DocumentsModal({
  open,
  onClose,
  orgId,
  staffProfileId,
  staffName,
  canManage = false,
  onChanged,
  title,
}: DocumentsModalProps): JSX.Element {
  const { confirm } = useConfirm();
  const [documents, setDocuments] = useState<StaffDocument[]>([]);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(BLANK);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [docs, t] = await Promise.all([
        listDocuments(orgId, staffProfileId),
        listDocumentTypes(orgId),
      ]);
      setDocuments(docs);
      setTypes(t.types.filter((x) => x.status === 'active'));
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

  const chosenType = types.find((t) => t.id === form.typeId) ?? null;

  const handleFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const chosen = e.target.files?.[0] ?? null;
    const problem = chosen ? documentFileProblem(chosen) : null;
    setError(problem);
    setFile(problem ? null : chosen);
    if (problem && fileInputRef.current) fileInputRef.current.value = '';
  };

  const replaceRow = (next: StaffDocument): void => {
    setDocuments((prev) => prev.map((d) => (d.id === next.id ? next : d)));
    onChanged?.();
  };

  const handleAdd = async (): Promise<void> => {
    if (!form.typeId || !file) return;
    setBusy(true);
    setError(null);
    try {
      const created = await uploadDocument(
        orgId,
        {
          staff_profile_id: staffProfileId,
          document_type_id: form.typeId,
          name: form.name.trim() || undefined,
          issued_at: form.issuedAt || null,
          expires_at: form.expiresAt || null,
          submit: form.submit,
        },
        file,
      );
      setDocuments((prev) => [created, ...prev]);
      setForm(BLANK);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onChanged?.();
    } catch (err) {
      reportError(err, { area: 'staff:documents-add' });
      setError(messageOf(err, 'Could not upload this document. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (doc: StaffDocument): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      replaceRow(await submitDocument(orgId, doc));
    } catch (err) {
      reportError(err, { area: 'staff:documents-submit' });
      setError(messageOf(err, 'Could not send that document for review.'));
    } finally {
      setBusy(false);
    }
  };

  const handleWithdraw = async (doc: StaffDocument): Promise<void> => {
    const ok = await confirm({
      title: 'Withdraw this document?',
      message:
        doc.stored_status === 'approved'
          ? `"${doc.name}" will stop counting for ${staffName} at once. It stays in their history.`
          : `"${doc.name}" will be withdrawn. It stays in the history.`,
      confirmLabel: 'Withdraw',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      replaceRow(await withdrawDocument(orgId, doc));
    } catch (err) {
      reportError(err, { area: 'staff:documents-withdraw' });
      setError(messageOf(err, 'Could not withdraw that document.'));
    } finally {
      setBusy(false);
    }
  };

  // The window is opened inside the click, before the await, because a window opened after one
  // is treated as a pop-up and blocked. It is then pointed at the one-minute link.
  const handleOpen = async (doc: StaffDocument): Promise<void> => {
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    try {
      const url = await documentOpenUrl(orgId, doc.id);
      if (win) win.location.href = url;
      else window.location.assign(url);
    } catch (err) {
      win?.close();
      reportError(err, { area: 'staff:documents-open' });
      setError('Could not open that document.');
    }
  };

  const muted = 'text-sm text-content-muted dark:text-content-muted-dark';

  return (
    <Modal open={open} onClose={onClose} title={title ?? `Documents, ${staffName}`}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        {loading ? (
          <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
        ) : documents.length === 0 ? (
          <p className={muted}>No documents on file yet.</p>
        ) : (
          <ul className="space-y-2">
            {documents.map((d) => {
              const can = allowedActions(d, canManage);
              return (
                <li
                  key={d.id}
                  className="rounded-xl border border-surface-border p-3 dark:border-surface-border-dark"
                >
                  <div className="flex items-start justify-between gap-3">
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
                      <p className={muted}>
                        {d.type}
                        {d.expires_at && ` · expires ${d.expires_at}`}
                      </p>
                      {d.stored_status === 'rejected' && d.rejection_reason && (
                        <p className="mt-1 text-sm text-danger-ink dark:text-danger-ink-dark">
                          Reason: {d.rejection_reason}
                        </p>
                      )}
                    </div>
                    <Badge tone={statusTone(d.status)} className="shrink-0">
                      {STATUS_LABELS[d.status]}
                    </Badge>
                  </div>
                  {(can.submit || can.withdraw) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {can.submit && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void handleSubmit(d)}
                        >
                          <Send size={14} aria-hidden="true" className="mr-1.5" />
                          Send for review
                        </Button>
                      )}
                      {can.withdraw && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void handleWithdraw(d)}
                        >
                          <Undo2 size={14} aria-hidden="true" className="mr-1.5" />
                          Withdraw
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <p className="text-sm text-danger-ink dark:text-danger-ink-dark" role="alert">
            {error}
          </p>
        )}

        <Callout tone="info" title="How documents are checked and kept">
          <p>
            A document counts only once an owner or manager has approved it, and never the
            person it is about. Files are stored privately: only this person and your
            organisation&apos;s owners and managers can open them.
          </p>
          <p>
            A replaced or withdrawn document stays in the history. Erasing the person or
            deleting the organisation deletes the files.
          </p>
        </Callout>

        {types.length === 0 && !loading ? (
          <p className={muted}>
            No document types are set up yet. An owner or manager adds them in Settings,
            Document types.
          </p>
        ) : (
          <div className="space-y-3 rounded-xl border border-surface-border p-3 dark:border-surface-border-dark">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="doc-type">Type</Label>
                <Select
                  id="doc-type"
                  value={form.typeId}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                    setForm((f) => ({ ...f, typeId: e.target.value }))
                  }
                >
                  <option value="">Choose a type</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.required ? ' (required)' : ''}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="doc-name">Name or number (optional)</Label>
                <Input
                  id="doc-name"
                  value={form.name}
                  maxLength={200}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
              </div>
            </div>
            {chosenType?.description && <p className={muted}>{chosenType.description}</p>}
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
                <Label htmlFor="doc-expires">
                  Expires{chosenType?.requires_expiry ? '' : ' (if it does)'}
                </Label>
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
            <label className="flex items-center gap-2 text-sm text-content dark:text-content-dark">
              <input
                type="checkbox"
                checked={form.submit}
                onChange={(e) => setForm((f) => ({ ...f, submit: e.target.checked }))}
              />
              Send for review now (otherwise it is saved as a draft)
            </label>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void handleAdd()}
              disabled={busy || !form.typeId || !file}
            >
              <Plus size={16} aria-hidden="true" className="mr-1.5" />
              {busy ? 'Working…' : 'Add document'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
