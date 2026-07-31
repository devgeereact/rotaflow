import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  FileText,
  Plus,
  Search,
  ShieldOff,
  Siren,
  UserRoundX,
  UserRoundCheck,
} from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import {
  createStaffProfile,
  deactivateStaffProfile,
  listStaff,
  reactivateStaffProfile,
  updateStaffProfile,
} from '@/services/staffService';
import { listDepartments } from '@/services/locationService';
import { anonymizeStaffMember, exportStaffData } from '@/services/gdprService';
import { EmergencyContactsModal } from '@/components/staff/EmergencyContactsModal';
import { DocumentsModal } from '@/components/staff/DocumentsModal';
import { downloadJson } from '@/lib/csv';
import { reportError } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { StaffFormModal, type StaffFormValues } from '@/components/staff/StaffFormModal';
import type { Department, StaffProfile, StaffProfileInsert } from '@/types';

const CONTRACT_LABELS: Record<string, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  zero_hours: 'Zero-hours',
  casual: 'Casual',
};

function toInsert(orgId: string, values: StaffFormValues): StaffProfileInsert {
  return {
    org_id: orgId,
    first_name: values.firstName.trim(),
    last_name: values.lastName.trim(),
    job_title: values.jobTitle.trim() || null,
    department_id: values.departmentId || null,
    contract_type: values.contractType || null,
    weekly_hours: values.weeklyHours ? Number(values.weeklyHours) : null,
    holiday_allowance: values.holidayAllowance ? Number(values.holidayAllowance) : null,
    skills: values.skills
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    payroll_id: values.payrollId.trim() || null,
    start_date: values.startDate || null,
    phone: values.phone.trim() || null,
  };
}

export function StaffPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canManageStaff, canManageOrg } = usePermissions();

  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gdprBusyId, setGdprBusyId] = useState<string | null>(null);
  const [emergencyContactsFor, setEmergencyContactsFor] = useState<StaffProfile | null>(
    null,
  );
  const [documentsFor, setDocumentsFor] = useState<StaffProfile | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [staffRows, deptRows] = await Promise.all([
        listStaff(orgId, { includeInactive: true }),
        listDepartments(orgId),
      ]);
      setStaff(staffRows);
      setDepartments(deptRows);
    } catch (err) {
      reportError(err, { area: 'staff:load' });
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const departmentName = (id: string | null): string =>
    departments.find((d) => d.id === id)?.name ?? '—';

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return staff
      .filter((s) => showInactive || s.active)
      .filter((s) =>
        term
          ? `${s.first_name} ${s.last_name} ${s.job_title ?? ''}`
              .toLowerCase()
              .includes(term)
          : true,
      );
  }, [staff, showInactive, search]);

  const handleSubmit = async (values: StaffFormValues): Promise<void> => {
    if (!orgId) return;
    if (editingStaff) {
      const updated = await updateStaffProfile(editingStaff.id, toInsert(orgId, values));
      setStaff((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } else {
      const created = await createStaffProfile(toInsert(orgId, values));
      setStaff((prev) => [...prev, created]);
    }
  };

  const openCreate = (): void => {
    setEditingStaff(null);
    setModalOpen(true);
  };

  const openEdit = (person: StaffProfile): void => {
    setEditingStaff(person);
    setModalOpen(true);
  };

  const toggleActive = async (person: StaffProfile): Promise<void> => {
    setError(null);
    try {
      const updated = person.active
        ? await deactivateStaffProfile(person.id)
        : await reactivateStaffProfile(person.id);
      setStaff((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      reportError(err, { area: 'staff:toggle-active' });
      setError(
        `Could not ${person.active ? 'deactivate' : 'reactivate'} ${person.first_name} ${person.last_name}.`,
      );
    }
  };

  /** GDPR subject-access request — everything RotaFlow holds on this person, as a JSON file. */
  const handleExportData = async (person: StaffProfile): Promise<void> => {
    setError(null);
    setGdprBusyId(person.id);
    try {
      const data = await exportStaffData(person.id);
      downloadJson(`${person.first_name}-${person.last_name}-data-export`, data);
    } catch (err) {
      reportError(err, { area: 'staff:gdpr-export' });
      setError(`Could not export data for ${person.first_name} ${person.last_name}.`);
    } finally {
      setGdprBusyId(null);
    }
  };

  /**
   * GDPR erasure request. Scrubs PII on the staff_profiles row and deletes
   * emergency_contacts/documents outright; every shift/timesheet/leave row
   * stays intact, now pointing at an anonymized "Deleted Member" — see
   * 0011_gdpr_anonymize.sql. Does not delete their RotaFlow login, which may
   * span other organisations.
   */
  const handleAnonymize = async (person: StaffProfile): Promise<void> => {
    if (!orgId) return;
    if (
      !window.confirm(
        `Erase ${person.first_name} ${person.last_name}'s personal data from this organisation? ` +
          `Their name, phone and photo are permanently scrubbed and their emergency contacts and ` +
          `documents are deleted. Shift, leave and timesheet history is kept but no longer shows who ` +
          `it belonged to. This cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    setGdprBusyId(person.id);
    try {
      await anonymizeStaffMember(orgId, person.id);
      await load();
    } catch (err) {
      reportError(err, { area: 'staff:gdpr-anonymize' });
      setError(`Could not erase data for ${person.first_name} ${person.last_name}.`);
    } finally {
      setGdprBusyId(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl text-content dark:text-content-dark">
          Staff
        </h1>
        {canManageStaff && (
          <Button size="sm" onClick={openCreate}>
            <Plus size={16} aria-hidden="true" className="mr-1.5" />
            Add staff
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted dark:text-content-muted-dark"
          />
          <Input
            className="pl-9"
            placeholder="Search staff…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={() => setShowInactive((v) => !v)}
          className={cn(
            'rounded-full border px-3 py-1.5 text-sm',
            showInactive
              ? 'border-primary text-primary'
              : 'border-surface-border text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark',
          )}
        >
          Show inactive
        </button>
      </div>

      {error && (
        <p className="mb-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
      ) : filtered.length === 0 ? (
        <Card className="text-center text-content-muted dark:text-content-muted-dark">
          No staff match this view yet.
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-surface-border text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Job title</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Contract</th>
                <th className="px-4 py-3 font-medium">Weekly hours</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {canManageStaff && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((person) => (
                <tr
                  key={person.id}
                  className="border-b border-surface-border last:border-0 hover:bg-surface-subtle dark:border-surface-border-dark dark:hover:bg-surface-subtle-dark"
                >
                  <td
                    className={cn(
                      'px-4 py-3 font-medium text-content dark:text-content-dark',
                      canManageStaff && 'cursor-pointer',
                    )}
                    onClick={() => canManageStaff && openEdit(person)}
                  >
                    {person.first_name} {person.last_name}
                  </td>
                  <td className="px-4 py-3 text-content-muted dark:text-content-muted-dark">
                    {person.job_title || '—'}
                  </td>
                  <td className="px-4 py-3 text-content-muted dark:text-content-muted-dark">
                    {departmentName(person.department_id)}
                  </td>
                  <td className="px-4 py-3 text-content-muted dark:text-content-muted-dark">
                    {person.contract_type
                      ? (CONTRACT_LABELS[person.contract_type] ?? person.contract_type)
                      : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-content-muted dark:text-content-muted-dark">
                    {person.weekly_hours ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                        person.active
                          ? 'bg-success/10 text-success'
                          : 'bg-secondary/10 text-secondary dark:text-secondary-dark',
                      )}
                    >
                      {person.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canManageStaff && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {canManageOrg && (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleExportData(person)}
                              disabled={gdprBusyId === person.id}
                              aria-label={`Export data for ${person.first_name} ${person.last_name}`}
                              title="Export their data (GDPR)"
                              className="text-content-muted hover:text-primary disabled:opacity-50 dark:text-content-muted-dark"
                            >
                              <Download size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleAnonymize(person)}
                              disabled={gdprBusyId === person.id}
                              aria-label={`Erase personal data for ${person.first_name} ${person.last_name}`}
                              title="Erase their personal data (GDPR)"
                              className="text-content-muted hover:text-danger disabled:opacity-50 dark:text-content-muted-dark"
                            >
                              <ShieldOff size={16} />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setEmergencyContactsFor(person)}
                          aria-label={`Emergency contacts for ${person.first_name} ${person.last_name}`}
                          title="Emergency contacts"
                          className="text-content-muted hover:text-primary dark:text-content-muted-dark"
                        >
                          <Siren size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDocumentsFor(person)}
                          aria-label={`Documents for ${person.first_name} ${person.last_name}`}
                          title="Documents"
                          className="text-content-muted hover:text-primary dark:text-content-muted-dark"
                        >
                          <FileText size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleActive(person)}
                          aria-label={person.active ? 'Deactivate' : 'Reactivate'}
                          className="text-content-muted hover:text-primary dark:text-content-muted-dark"
                        >
                          {person.active ? (
                            <UserRoundX size={16} />
                          ) : (
                            <UserRoundCheck size={16} />
                          )}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <StaffFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        departments={departments}
        initial={editingStaff}
      />

      {orgId && emergencyContactsFor && (
        <EmergencyContactsModal
          open={Boolean(emergencyContactsFor)}
          onClose={() => setEmergencyContactsFor(null)}
          orgId={orgId}
          staffProfileId={emergencyContactsFor.id}
          staffName={`${emergencyContactsFor.first_name} ${emergencyContactsFor.last_name}`}
        />
      )}

      {orgId && documentsFor && (
        <DocumentsModal
          open={Boolean(documentsFor)}
          onClose={() => setDocumentsFor(null)}
          orgId={orgId}
          staffProfileId={documentsFor.id}
          staffName={`${documentsFor.first_name} ${documentsFor.last_name}`}
        />
      )}
    </div>
  );
}
