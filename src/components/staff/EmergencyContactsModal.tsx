import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import {
  createEmergencyContact,
  deleteEmergencyContact,
  listEmergencyContacts,
} from '@/services/emergencyContactService';
import { reportError } from '@/lib/sentry';
import { useConfirm } from '@/hooks/useConfirm';
import type { EmergencyContact } from '@/types';

interface EmergencyContactsModalProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  staffProfileId: string;
  staffName: string;
}

const BLANK = {
  name: '',
  relationship: '',
  phone: '',
  secondaryPhone: '',
  medicalNotes: '',
};

/**
 * Add + delete only, no edit — a contact you got wrong is faster to remove
 * and re-add than to build an edit flow for, matching the same "edit-only
 * where it earns its keep" call `locationService.ts` makes for locations.
 */
export function EmergencyContactsModal({
  open,
  onClose,
  orgId,
  staffProfileId,
  staffName,
}: EmergencyContactsModalProps): JSX.Element {
  const { confirm } = useConfirm();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(BLANK);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setContacts(await listEmergencyContacts(orgId, staffProfileId));
    } catch (err) {
      reportError(err, { area: 'staff:emergency-contacts-load' });
      setError('Could not load emergency contacts.');
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
    if (!form.name.trim() || !form.phone.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createEmergencyContact({
        staff_profile_id: staffProfileId,
        org_id: orgId,
        name: form.name.trim(),
        relationship: form.relationship.trim() || null,
        phone: form.phone.trim(),
        secondary_phone: form.secondaryPhone.trim() || null,
        medical_notes: form.medicalNotes.trim() || null,
      });
      setContacts((prev) => [...prev, created]);
      setForm(BLANK);
    } catch (err) {
      reportError(err, { area: 'staff:emergency-contacts-add' });
      setError('Could not add this contact. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (contact: EmergencyContact): Promise<void> => {
    const ok = await confirm({
      title: 'Remove emergency contact?',
      message: `${contact.name} will no longer be listed as an emergency contact for this staff member.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteEmergencyContact(orgId, contact.id);
      setContacts((prev) => prev.filter((c) => c.id !== contact.id));
    } catch (err) {
      reportError(err, { area: 'staff:emergency-contacts-delete' });
      setError('Could not remove that contact.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Emergency contacts — ${staffName}`}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        {loading ? (
          <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
        ) : contacts.length === 0 ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            No emergency contacts on file yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {contacts.map((c) => (
              <li
                key={c.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-surface-border p-3 dark:border-surface-border-dark"
              >
                <div>
                  <p className="font-medium text-content dark:text-content-dark">
                    {c.name}
                    {c.relationship && (
                      <span className="ml-1.5 text-sm font-normal text-content-muted dark:text-content-muted-dark">
                        ({c.relationship})
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-content-muted dark:text-content-muted-dark">
                    {c.phone}
                    {c.secondary_phone && ` · ${c.secondary_phone}`}
                  </p>
                  {c.medical_notes && (
                    <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
                      {c.medical_notes}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void handleDelete(c)}
                  aria-label={`Remove ${c.name}`}
                  className="shrink-0 rounded text-content-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-3 rounded-xl border border-surface-border p-3 dark:border-surface-border-dark">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ec-name">Name</Label>
              <Input
                id="ec-name"
                value={form.name}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="ec-relationship">Relationship</Label>
              <Input
                id="ec-relationship"
                value={form.relationship}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((f) => ({ ...f, relationship: e.target.value }))
                }
                placeholder="Spouse, parent…"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ec-phone">Phone</Label>
              <Input
                id="ec-phone"
                value={form.phone}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((f) => ({ ...f, phone: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="ec-secondary-phone">Secondary phone</Label>
              <Input
                id="ec-secondary-phone"
                value={form.secondaryPhone}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((f) => ({ ...f, secondaryPhone: e.target.value }))
                }
              />
            </div>
          </div>
          <div>
            <Label htmlFor="ec-medical">
              Medical notes{' '}
              <span className="text-content-muted dark:text-content-muted-dark">
                (optional — special-category data, only what's needed in an emergency)
              </span>
            </Label>
            <Input
              id="ec-medical"
              value={form.medicalNotes}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setForm((f) => ({ ...f, medicalNotes: e.target.value }))
              }
              placeholder="Allergies, conditions…"
            />
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
            disabled={submitting || !form.name.trim() || !form.phone.trim()}
          >
            <Plus size={16} aria-hidden="true" className="mr-1.5" />
            {submitting ? 'Adding…' : 'Add contact'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
