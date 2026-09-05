import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Field } from '@/components/ui/Field';
import { Label } from '@/components/ui/Label';
import type { Department, Location, StaffProfile } from '@/types';

const CONTRACT_TYPES = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'zero_hours', label: 'Zero-hours' },
  { value: 'casual', label: 'Casual' },
];

export interface StaffFormValues {
  firstName: string;
  lastName: string;
  jobTitle: string;
  departmentId: string;
  contractType: string;
  weeklyHours: string;
  holidayAllowance: string;
  skills: string; // comma-separated
  payrollId: string;
  startDate: string;
  phone: string;
  email: string;
  /**
   * Sites this person works (CAP-089).
   *
   * An empty list means "nothing recorded", not "works nowhere": every read
   * falls back to their department's site, which is what the product did
   * before this existed.
   */
  locationIds: string[];
}

interface StaffFormModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: StaffFormValues) => Promise<void>;
  departments: Department[];
  locations: Location[];
  /** Sites already recorded for the person being edited. */
  initialLocationIds?: readonly string[];
  initial?: StaffProfile | null;
}

function toFormValues(
  staff?: StaffProfile | null,
  locationIds: readonly string[] = [],
): StaffFormValues {
  return {
    firstName: staff?.first_name ?? '',
    lastName: staff?.last_name ?? '',
    jobTitle: staff?.job_title ?? '',
    departmentId: staff?.department_id ?? '',
    contractType: staff?.contract_type ?? 'full_time',
    weeklyHours: staff?.weekly_hours?.toString() ?? '',
    holidayAllowance: staff?.holiday_allowance?.toString() ?? '',
    skills: staff?.skills?.join(', ') ?? '',
    payrollId: staff?.payroll_id ?? '',
    startDate: staff?.start_date ?? '',
    phone: staff?.phone ?? '',
    email: staff?.email ?? '',
    locationIds: [...locationIds],
  };
}

export function StaffFormModal({
  open,
  onClose,
  onSubmit,
  departments,
  initial,
  locations,
  initialLocationIds = [],
}: StaffFormModalProps): JSX.Element {
  const [values, setValues] = useState<StaffFormValues>(
    toFormValues(initial, initialLocationIds),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Joined into a string so a caller passing a fresh array on every render
  // does not reset the form under the user's hands mid-edit. The values are
  // ids, so the string is a faithful identity for the set.
  const initialLocationKey = initialLocationIds.join(',');

  useEffect(() => {
    if (open) {
      setValues(
        toFormValues(initial, initialLocationKey ? initialLocationKey.split(',') : []),
      );
      setError(null);
    }
  }, [open, initial, initialLocationKey]);

  const handleSubmit = async (): Promise<void> => {
    if (!values.firstName.trim() || !values.lastName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      setError(
        code === '23505'
          ? 'That payroll ID is already in use by someone else in this organisation.'
          : 'Could not save this staff profile. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit staff' : 'Add staff'}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        {/* `Field` rather than a hand-wired Label + Input: it is what carries
            the required marker (visible *and* announced) and, when validation
            arrives, puts the message in the same place on every form. */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="First name" required>
            <Input
              value={values.firstName}
              onChange={(e) => setValues((v) => ({ ...v, firstName: e.target.value }))}
            />
          </Field>
          <Field label="Last name" required>
            <Input
              value={values.lastName}
              onChange={(e) => setValues((v) => ({ ...v, lastName: e.target.value }))}
            />
          </Field>
        </div>

        <div>
          <Label htmlFor="staff-title">Job title</Label>
          <Input
            id="staff-title"
            value={values.jobTitle}
            onChange={(e) => setValues((v) => ({ ...v, jobTitle: e.target.value }))}
            placeholder="Registered Nurse"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="staff-dept">Department</Label>
            <Select
              id="staff-dept"
              value={values.departmentId}
              onChange={(e) => setValues((v) => ({ ...v, departmentId: e.target.value }))}
            >
              <option value="">No department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="staff-contract">Contract type</Label>
            <Select
              id="staff-contract"
              value={values.contractType}
              onChange={(e) => setValues((v) => ({ ...v, contractType: e.target.value }))}
            >
              {CONTRACT_TYPES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Weekly hours" hint="Contracted, not rostered.">
            <Input
              type="number"
              min="0"
              step="0.5"
              value={values.weeklyHours}
              onChange={(e) => setValues((v) => ({ ...v, weeklyHours: e.target.value }))}
            />
          </Field>
          <Field label="Holiday allowance (days)">
            <Input
              type="number"
              min="0"
              step="0.5"
              value={values.holidayAllowance}
              onChange={(e) =>
                setValues((v) => ({ ...v, holidayAllowance: e.target.value }))
              }
            />
          </Field>
        </div>

        <div>
          <fieldset className="mb-5">
            <legend className="mb-2 text-sm font-medium text-content dark:text-content-dark">
              Sites they work
            </legend>
            <p className="mb-3 text-sm text-content-muted dark:text-content-muted-dark">
              Leave every box clear to use their department&rsquo;s site. Ticking any
              replaces that — it is how somebody covers two wards.
            </p>
            <div className="flex flex-wrap gap-3">
              {locations.map((location) => (
                <label
                  key={location.id}
                  className="flex items-center gap-2 text-sm text-content dark:text-content-dark"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-surface-border"
                    checked={values.locationIds.includes(location.id)}
                    onChange={(event) =>
                      setValues((v) => ({
                        ...v,
                        locationIds: event.target.checked
                          ? [...v.locationIds, location.id]
                          : v.locationIds.filter((id) => id !== location.id),
                      }))
                    }
                  />
                  {location.name}
                </label>
              ))}
            </div>
          </fieldset>

          <Label htmlFor="staff-skills">Skills</Label>
          <Input
            id="staff-skills"
            value={values.skills}
            onChange={(e) => setValues((v) => ({ ...v, skills: e.target.value }))}
            placeholder="Medication, Manual handling, First aid"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="staff-payroll">Payroll ID</Label>
            <Input
              id="staff-payroll"
              value={values.payrollId}
              disabled={Boolean(initial?.payroll_id)}
              onChange={(e) => setValues((v) => ({ ...v, payrollId: e.target.value }))}
            />
            {initial?.payroll_id && (
              <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
                Set once and locked — a payroll ID never changes once issued.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="staff-phone">Phone</Label>
            <Input
              id="staff-phone"
              value={values.phone}
              onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="staff-email">Email</Label>
          <Input
            id="staff-email"
            type="email"
            value={values.email}
            onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
            placeholder="jordan@example.com"
          />
          <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
            {initial?.user_id
              ? 'Linked to their account — they can see their own schedule.'
              : "Matched against their invite email so they can see their own schedule once they accept it. Doesn't send them anything directly."}
          </p>
        </div>

        <div>
          <Label htmlFor="staff-start">Start date</Label>
          <Input
            id="staff-start"
            type="date"
            value={values.startDate}
            onChange={(e) => setValues((v) => ({ ...v, startDate: e.target.value }))}
          />
        </div>

        {error && (
          <p className="text-sm text-danger-ink dark:text-danger-ink-dark">{error}</p>
        )}

        <Button
          className="w-full"
          onClick={() => void handleSubmit()}
          disabled={submitting || !values.firstName.trim() || !values.lastName.trim()}
        >
          {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add staff'}
        </Button>
      </div>
    </Modal>
  );
}
