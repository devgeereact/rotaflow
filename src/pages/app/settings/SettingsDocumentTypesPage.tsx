import { useCallback, useEffect, useState, type ChangeEvent, type JSX } from 'react';
import { Archive, Pencil, Plus } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useToast } from '@/hooks/useToast';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Callout } from '@/components/ui/Callout';
import { LoadingState } from '@/components/ui/LoadingState';
import { useConfirm } from '@/hooks/useConfirm';
import {
  addPresetType,
  archiveDocumentType,
  createDocumentType,
  listDocumentTypes,
  STAFF_DOCUMENTS_FEATURE,
  updateDocumentType,
  type DocumentPreset,
  type DocumentTypeInput,
} from '@/services/documentService';
import type { DocumentType } from '@/lib/compliance';
import { ApiError } from '@/lib/api';
import { reportError } from '@/lib/sentry';

const BLANK: DocumentTypeInput = {
  name: '',
  description: '',
  requires_expiry: false,
  default_validity_months: null,
  required: false,
};

/**
 * `/app/settings/document-types` (compliance, slice S10). Owners and managers define what staff keep
 * on file: a required type must be approved and in date for a person to be cleared to work. The UK
 * examples are a starting point, not legal advice. Archiving lifts a requirement and keeps every
 * document already filed against it.
 */
export function SettingsDocumentTypesPage(): JSX.Element {
  const { orgId } = useOrg();
  const enabled = useFeatureAccess().has(STAFF_DOCUMENTS_FEATURE);
  const { showError, showSuccess } = useToast();
  const { confirm } = useConfirm();
  const [types, setTypes] = useState<DocumentType[] | null>(null);
  const [presets, setPresets] = useState<DocumentPreset[]>([]);
  const [editing, setEditing] = useState<DocumentType | 'new' | null>(null);
  const [form, setForm] = useState<DocumentTypeInput>(BLANK);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    try {
      const r = await listDocumentTypes(orgId);
      setTypes(r.types);
      setPresets(r.presets ?? []);
    } catch (err) {
      reportError(err, { area: 'settings:document-types' });
      setTypes([]);
      showError('Document types could not be loaded.');
    }
  }, [orgId, showError]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  const fail = (err: unknown, fallback: string): void => {
    reportError(err, { area: 'settings:document-types-write' });
    showError(err instanceof ApiError && err.message ? err.message : fallback);
  };

  const save = async (): Promise<void> => {
    if (!orgId || editing === null) return;
    setBusy(true);
    try {
      if (editing === 'new') await createDocumentType(orgId, form);
      else await updateDocumentType(orgId, editing, form);
      showSuccess(editing === 'new' ? 'Document type added.' : 'Document type saved.');
      setEditing(null);
      await load();
    } catch (err) {
      fail(err, 'That document type could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const addPreset = async (key: string): Promise<void> => {
    if (!orgId) return;
    setBusy(true);
    try {
      await addPresetType(orgId, key);
      await load();
    } catch (err) {
      fail(err, 'That example could not be added.');
    } finally {
      setBusy(false);
    }
  };

  const archive = async (t: DocumentType): Promise<void> => {
    if (!orgId) return;
    const ok = await confirm({
      title: `Archive ${t.name}?`,
      message:
        'It stops being required and cannot be chosen for new uploads. Documents already filed against it stay.',
      confirmLabel: 'Archive',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await archiveDocumentType(orgId, t);
      await load();
    } catch (err) {
      fail(err, 'That document type could not be archived.');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (t: DocumentType | 'new'): void => {
    setEditing(t);
    setForm(
      t === 'new'
        ? BLANK
        : {
            name: t.name,
            description: t.description,
            requires_expiry: t.requires_expiry,
            default_validity_months: t.default_validity_months,
            required: t.required,
          },
    );
  };

  if (!enabled) {
    return (
      <Card>
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Staff documents are not switched on for your organisation yet.
        </p>
      </Card>
    );
  }
  if (types === null) return <LoadingState label="Loading document types" />;

  const muted = 'text-sm text-content-muted dark:text-content-muted-dark';
  const active = types.filter((t) => t.status === 'active');
  const archived = types.filter((t) => t.status === 'archived');
  const remaining = presets.filter((p) => !p.added);

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-content dark:text-content-dark">
            Document types
          </h2>
          <Button size="sm" onClick={() => startEdit('new')} disabled={busy}>
            <Plus size={16} aria-hidden="true" className="mr-1.5" />
            Add a type
          </Button>
        </div>
        {active.length === 0 ? (
          <p className={muted}>
            None yet. Add your own, or start from a UK example below.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
            {active.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-start justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-content dark:text-content-dark">
                    {t.name}{' '}
                    {t.required && <Badge tone="primary">Required to work</Badge>}
                  </p>
                  {t.description && <p className={muted}>{t.description}</p>}
                  <p className={muted}>
                    {t.requires_expiry ? 'Needs an expiry date' : 'Expiry date optional'}
                    {t.default_validity_months !== null &&
                      ` · lasts ${t.default_validity_months} months from issue`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => startEdit(t)}
                    disabled={busy}
                  >
                    <Pencil size={14} aria-hidden="true" className="mr-1.5" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void archive(t)}
                    disabled={busy}
                  >
                    <Archive size={14} aria-hidden="true" className="mr-1.5" />
                    Archive
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {archived.length > 0 && (
          <p className={`mt-3 ${muted}`}>
            Archived: {archived.map((t) => t.name).join(', ')}.
          </p>
        )}
      </Card>

      {editing !== null && (
        <Card>
          <h2 className="mb-3 text-base font-semibold text-content dark:text-content-dark">
            {editing === 'new' ? 'New document type' : `Edit ${editing.name}`}
          </h2>
          <div className="space-y-3">
            <div>
              <Label htmlFor="dt-name">Name</Label>
              <Input
                id="dt-name"
                value={form.name}
                maxLength={100}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="dt-desc">Description (optional)</Label>
              <Input
                id="dt-desc"
                value={form.description}
                maxLength={500}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="dt-valid">
                Lasts this many months from issue (optional)
              </Label>
              <Input
                id="dt-valid"
                type="number"
                min={1}
                max={120}
                value={form.default_validity_months ?? ''}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((f) => ({
                    ...f,
                    default_validity_months:
                      e.target.value === '' ? null : Math.trunc(Number(e.target.value)),
                  }))
                }
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-content dark:text-content-dark">
              <input
                type="checkbox"
                checked={form.required}
                onChange={(e) => setForm((f) => ({ ...f, required: e.target.checked }))}
              />
              Required to work (everyone on the rota must have it approved and in date)
            </label>
            <label className="flex items-center gap-2 text-sm text-content dark:text-content-dark">
              <input
                type="checkbox"
                checked={form.requires_expiry}
                onChange={(e) =>
                  setForm((f) => ({ ...f, requires_expiry: e.target.checked }))
                }
              />
              Needs an expiry date
            </label>
            <div className="flex gap-2">
              <Button
                onClick={() => void save()}
                disabled={busy || form.name.trim().length < 2}
              >
                Save
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {remaining.length > 0 && (
        <Card>
          <h2 className="mb-1 text-base font-semibold text-content dark:text-content-dark">
            UK examples
          </h2>
          <p className={`mb-3 ${muted}`}>
            A starting point, not legal advice. Check what your sector and your regulator
            expect.
          </p>
          <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
            {remaining.map((p) => (
              <li
                key={p.key}
                className="flex flex-wrap items-start justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-content dark:text-content-dark">
                    {p.name}{' '}
                    {p.required && <Badge tone="primary">Required to work</Badge>}
                  </p>
                  <p className={muted}>{p.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void addPreset(p.key)}
                  disabled={busy}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Callout tone="info" title="What required means">
        <p>
          A person is cleared to work when every required type has an approved document
          that is in date. The rota builder shows who is not cleared; it does not stop you
          rostering them.
        </p>
      </Callout>
    </div>
  );
}
