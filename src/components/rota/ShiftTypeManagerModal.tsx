import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, ArrowLeft } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { cn } from '@/lib/utils';
import { SHIFT_PALETTE, paletteTokenForColour } from '@/lib/shiftPalette';
import {
  createShiftType,
  deleteShiftType,
  updateShiftType,
} from '@/services/shiftTypeService';
import { reportError } from '@/lib/sentry';
import { useConfirm } from '@/hooks/useConfirm';
import type { ShiftType } from '@/types';

interface ShiftTypeManagerModalProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  shiftTypes: ShiftType[];
  onChange: (shiftTypes: ShiftType[]) => void;
}

interface FormState {
  name: string;
  colour: string;
  defaultStart: string;
  defaultEnd: string;
  isPaid: boolean;
  category: string;
}

const BLANK_FORM: FormState = {
  name: '',
  colour: SHIFT_PALETTE[0].hex,
  defaultStart: '',
  defaultEnd: '',
  isPaid: true,
  category: '',
};

export function ShiftTypeManagerModal({
  open,
  onClose,
  orgId,
  shiftTypes,
  onChange,
}: ShiftTypeManagerModalProps): JSX.Element {
  const { confirm } = useConfirm();
  const [view, setView] = useState<'list' | 'form'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setView('list');
      setError(null);
    }
  }, [open]);

  const startCreate = (): void => {
    setEditingId(null);
    setForm(BLANK_FORM);
    setView('form');
  };

  const startEdit = (type: ShiftType): void => {
    setEditingId(type.id);
    setForm({
      name: type.name,
      colour: type.colour,
      defaultStart: type.default_start ?? '',
      defaultEnd: type.default_end ?? '',
      isPaid: type.is_paid,
      category: type.category ?? '',
    });
    setView('form');
  };

  const handleSave = async (): Promise<void> => {
    if (!form.name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        colour: form.colour,
        default_start: form.defaultStart || null,
        default_end: form.defaultEnd || null,
        is_paid: form.isPaid,
        category: form.category.trim() || null,
      };
      if (editingId) {
        const updated = await updateShiftType(editingId, payload);
        onChange(shiftTypes.map((t) => (t.id === updated.id ? updated : t)));
      } else {
        const created = await createShiftType({ org_id: orgId, ...payload });
        onChange([...shiftTypes, created]);
      }
      setView('list');
    } catch (err) {
      reportError(err, { area: 'shift-types:save' });
      setError('Could not save this shift type.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string): Promise<void> => {
    const ok = await confirm({
      title: 'Delete shift type?',
      message: `"${name}" will be removed from this organisation. Shifts already using it keep their times but lose the type. This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteShiftType(id);
      onChange(shiftTypes.filter((t) => t.id !== id));
    } catch (err) {
      reportError(err, { area: 'shift-types:delete' });
      setError('Could not remove that shift type — it may be in use on the rota.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        view === 'list' ? 'Shift types' : editingId ? 'Edit shift type' : 'New shift type'
      }
    >
      {view === 'list' ? (
        <div>
          <ul className="mb-4 space-y-1">
            {shiftTypes.map((type) => (
              <li
                key={type.id}
                className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark"
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      'h-3 w-3 rounded-full',
                      paletteTokenForColour(type.colour),
                    )}
                    aria-hidden="true"
                  />
                  <span className="text-sm text-content dark:text-content-dark">
                    {type.name}
                  </span>
                  {type.default_start && type.default_end && (
                    <span className="font-mono text-xs text-content-muted dark:text-content-muted-dark">
                      {type.default_start}–{type.default_end}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(type)}
                    aria-label={`Edit ${type.name}`}
                    className="grid h-8 w-8 place-items-center rounded-lg text-content-muted transition-colors hover:bg-surface-subtle hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
                  >
                    <Pencil size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(type.id, type.name)}
                    aria-label={`Delete ${type.name}`}
                    className="grid h-8 w-8 place-items-center rounded-lg text-content-muted transition-colors hover:bg-surface-subtle hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
            {shiftTypes.length === 0 && (
              <li className="text-sm text-content-muted dark:text-content-muted-dark">
                No shift types yet.
              </li>
            )}
          </ul>
          {error && <p className="mb-3 text-sm text-danger">{error}</p>}
          <Button className="w-full" variant="secondary" onClick={startCreate}>
            <Plus size={16} aria-hidden="true" className="mr-1.5" />
            New shift type
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setView('list')}
            className="flex items-center gap-1.5 text-sm text-content-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark dark:hover:text-content-dark"
          >
            <ArrowLeft size={14} aria-hidden="true" /> Back
          </button>

          <div>
            <Label htmlFor="st-name">Name</Label>
            <Input
              id="st-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Early"
            />
          </div>

          <div>
            <Label>Colour</Label>
            <div className="flex flex-wrap gap-2">
              {SHIFT_PALETTE.map((swatch) => (
                <button
                  key={swatch.hex}
                  type="button"
                  aria-label={swatch.label}
                  onClick={() => setForm((f) => ({ ...f, colour: swatch.hex }))}
                  className={cn(
                    'h-8 w-8 rounded-full ring-offset-2 ring-offset-surface transition-shadow dark:ring-offset-surface-dark',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    swatch.bgClass,
                    form.colour === swatch.hex && 'ring-2 ring-primary',
                  )}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="st-start">Default start</Label>
              <Input
                id="st-start"
                type="time"
                value={form.defaultStart}
                onChange={(e) => setForm((f) => ({ ...f, defaultStart: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="st-end">Default end</Label>
              <Input
                id="st-end"
                type="time"
                value={form.defaultEnd}
                onChange={(e) => setForm((f) => ({ ...f, defaultEnd: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="st-category">Category</Label>
            <Input
              id="st-category"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="Day, Night, On-call…"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-content dark:text-content-dark">
            <input
              type="checkbox"
              checked={form.isPaid}
              onChange={(e) => setForm((f) => ({ ...f, isPaid: e.target.checked }))}
              className="h-4 w-4 rounded border-surface-border text-primary focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
            />
            Paid shift
          </label>

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button
            className="w-full"
            onClick={() => void handleSave()}
            disabled={submitting || !form.name.trim()}
          >
            {submitting ? 'Saving…' : 'Save shift type'}
          </Button>
        </div>
      )}
    </Modal>
  );
}
