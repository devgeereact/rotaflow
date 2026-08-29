import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import type { OrganisationDeletionPreview } from '@/services/orgLifecycleService';

/**
 * The confirmation for the only action in RotaFlow with no undo.
 *
 * Three things are deliberate here.
 *
 * The name has to be typed, and matched exactly — the database checks it too,
 * so this is not the boundary, it is the pause. Its job is to make the person
 * read which organisation they are on.
 *
 * The counts are real, fetched before the dialog opens. "This deletes your
 * organisation" is abstract; "this deletes 248 staff records and 6,412 shifts"
 * is the same sentence in a form somebody can weigh.
 *
 * The export is offered here rather than only on the page behind, because this
 * is the moment the data stops existing and there are no backups on this
 * project to fall back on.
 */
export function DeleteOrganisationModal({
  open,
  organisationName,
  preview,
  busy,
  exporting,
  onExport,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  organisationName: string;
  preview: OrganisationDeletionPreview | null;
  busy: boolean;
  exporting: boolean;
  onExport: () => void;
  onCancel: () => void;
  onConfirm: (typedName: string) => void;
}): JSX.Element {
  const [typed, setTyped] = useState('');

  // A fresh decision each time it opens, never a half-typed name from the
  // attempt someone backed out of.
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const matches = typed === organisationName;

  const rows: { label: string; value: number }[] = preview
    ? [
        { label: 'Staff records', value: preview.staffProfiles },
        { label: 'Shifts', value: preview.shifts },
        { label: 'Rotas', value: preview.rotas },
        { label: 'Clock events', value: preview.clockEvents },
        { label: 'Leave requests', value: preview.leaveRequests },
        { label: 'Documents', value: preview.documents },
        { label: 'Sites', value: preview.locations },
        { label: 'People with access', value: preview.members },
      ]
    : [];

  return (
    <Modal open={open} onClose={onCancel} title={`Delete ${organisationName}?`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!matches) return;
          onConfirm(typed);
        }}
      >
        <p className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-content dark:text-content-dark">
          This deletes the organisation and everything in it,{' '}
          <strong>permanently and immediately</strong>. It cannot be undone and there is
          no backup to restore from. Everyone here loses access at once.
        </p>

        {rows.length > 0 ? (
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-content-muted dark:text-content-muted-dark">
                  {row.label}
                </dt>
                <dd className="font-mono tabular-nums">
                  {row.value.toLocaleString('en-GB')}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        <p className="mt-4 text-sm text-content-muted dark:text-content-muted-dark">
          Take a copy first if you might need it. The export is one JSON file with every
          record above; uploaded files stay with ImageKit and are not included.
        </p>
        <Button
          type="button"
          variant="secondary"
          className="mt-2"
          onClick={onExport}
          disabled={exporting || busy}
        >
          {exporting ? 'Preparing export…' : 'Export everything first'}
        </Button>

        <div className="mt-5">
          <Label htmlFor="delete-org-confirm">
            Type <span className="font-semibold">{organisationName}</span> to confirm
          </Label>
          <Input
            id="delete-org-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="mt-1"
          />
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={busy || !matches}>
            {busy ? 'Deleting…' : 'Delete this organisation'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
