import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, format, isSameDay, startOfDay } from 'date-fns';
import {
  Download,
  FileText,
  Banknote,
  IdCard,
  Pencil,
  ShieldOff,
  Siren,
  UserRoundCheck,
  UserRoundX,
} from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useConfirm } from '@/hooks/useConfirm';
import {
  createStaffProfile,
  createStaffProfiles,
  deactivateStaffProfile,
  listStaff,
  reactivateStaffProfile,
  updateStaffProfile,
} from '@/services/staffService';
import { listDepartments, listLocations } from '@/services/locationService';
import { listOrgLeaveRequests } from '@/services/leaveService';
import { listShiftsForPeriod } from '@/services/shiftService';
import { listExpiringDocuments } from '@/services/documentService';
import { listPendingInvites } from '@/services/inviteService';
import { anonymizeStaffMember, exportStaffData } from '@/services/gdprService';
import { downloadCsv, downloadJson } from '@/lib/csv';
import { TeamDirectoryView } from '@/components/staff/TeamDirectoryView';
import {
  StaffActionsModal,
  type StaffAction,
} from '@/components/staff/StaffActionsModal';
import { EmergencyContactsModal } from '@/components/staff/EmergencyContactsModal';
import { DocumentsModal } from '@/components/staff/DocumentsModal';
import { ImportStaffModal } from '@/components/staff/ImportStaffModal';
import { PayRateModal } from '@/components/staff/PayRateModal';
import type { ImportPreview } from '@/lib/csvImport';
import { StaffFormModal, type StaffFormValues } from '@/components/staff/StaffFormModal';
import {
  buildTeamRows,
  buildTeamTiles,
  onTypeOfLeaveToday,
  weekRangeIso,
} from '@/lib/teamRows';
import { reportError } from '@/lib/sentry';
import type { TeamRow } from '@/lib/teamRows';
import type {
  Department,
  LeaveRequest,
  Location,
  Shift,
  StaffProfile,
  StaffProfileInsert,
} from '@/types';

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
    email: values.email.trim() ? values.email.trim().toLowerCase() : null,
  };
}

/**
 * `/app/team` (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.team`). The
 * reference's row actions are just Profile/Message; Message has no real
 * capability behind it (RotaFlow has no direct-messaging feature) so the
 * kebab menu here keeps the directory's existing real management actions
 * (edit, emergency contacts, documents, deactivate, GDPR) instead.
 */
export function StaffPage(): JSX.Element {
  const { confirm } = useConfirm();
  const { orgId, orgName } = useOrg();
  const { user } = useSupabaseAuth();
  const { canManageStaff, canManageOrg } = usePermissions();
  const navigate = useNavigate();

  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [leave, setLeave] = useState<LeaveRequest[]>([]);
  const [shiftsThisWeek, setShiftsThisWeek] = useState<Shift[]>([]);
  const [documentsExpiring, setDocumentsExpiring] = useState(0);
  const [invitesOutstanding, setInvitesOutstanding] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [payRateFor, setPayRateFor] = useState<StaffProfile | null>(null);
  const [editingStaff, setEditingStaff] = useState<StaffProfile | null>(null);
  const [actionsFor, setActionsFor] = useState<StaffProfile | null>(null);
  const [emergencyContactsFor, setEmergencyContactsFor] = useState<StaffProfile | null>(
    null,
  );
  const [documentsFor, setDocumentsFor] = useState<StaffProfile | null>(null);
  const [gdprBusyId, setGdprBusyId] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);
  const todayIso = format(today, 'yyyy-MM-dd');

  const load = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    setLoading(true);
    try {
      const { fromIso, toIso } = weekRangeIso(today);
      const in30Days = format(addDays(startOfDay(today), 30), 'yyyy-MM-dd');
      const [
        staffRows,
        deptRows,
        locationRows,
        leaveRows,
        shiftRows,
        expiringDocs,
        invites,
      ] = await Promise.all([
        listStaff(orgId, { includeInactive: true }),
        listDepartments(orgId),
        listLocations(orgId),
        listOrgLeaveRequests(orgId),
        listShiftsForPeriod({ orgId, fromIso, toIso }),
        listExpiringDocuments(orgId, in30Days),
        listPendingInvites(orgId),
      ]);
      setStaff(staffRows);
      setDepartments(deptRows);
      setLocations(locationRows);
      setLeave(leaveRows);
      setShiftsThisWeek(shiftRows);
      setDocumentsExpiring(expiringDocs.length);
      setInvitesOutstanding(invites.length);
    } catch (err) {
      reportError(err, { area: 'staff:load' });
      setError('Could not load the staff directory.');
    } finally {
      setLoading(false);
    }
  }, [orgId, today]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeRefresh({
    tables: ['staff_profiles', 'departments'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => void load(),
  });

  const onShiftToday = useMemo(
    () =>
      new Set(
        shiftsThisWeek
          .filter((s) => isSameDay(new Date(s.starts_at), today) && s.staff_profile_id)
          .map((s) => s.staff_profile_id as string),
      ),
    [shiftsThisWeek, today],
  );
  const absentToday = useMemo(
    () => onTypeOfLeaveToday(leave, todayIso, (t) => t === 'sick'),
    [leave, todayIso],
  );
  const onLeaveToday = useMemo(
    () => onTypeOfLeaveToday(leave, todayIso, () => true),
    [leave, todayIso],
  );

  const context = useMemo(
    () => ({ departments, locations, shiftsThisWeek, onShiftToday, absentToday }),
    [departments, locations, shiftsThisWeek, onShiftToday, absentToday],
  );

  const allRows = useMemo(() => buildTeamRows(staff, context), [staff, context]);

  const tiles = useMemo(
    () =>
      buildTeamTiles(
        staff,
        onShiftToday,
        absentToday,
        onLeaveToday,
        documentsExpiring,
        invitesOutstanding,
      ),
    [
      staff,
      onShiftToday,
      absentToday,
      onLeaveToday,
      documentsExpiring,
      invitesOutstanding,
    ],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (!row.active) return false;
      if (term) {
        const haystack =
          `${row.firstName} ${row.lastName} ${row.jobTitle ?? ''} ${row.location}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (
        departmentId &&
        staff.find((s) => s.id === row.id)?.department_id !== departmentId
      )
        return false;
      if (locationId) {
        const person = staff.find((s) => s.id === row.id);
        const dept = departments.find((d) => d.id === person?.department_id);
        if (dept?.location_id !== locationId) return false;
      }
      return true;
    });
  }, [allRows, search, departmentId, locationId, staff, departments]);

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

  const handleAnonymize = async (person: StaffProfile): Promise<void> => {
    if (!orgId) return;
    const ok = await confirm({
      title: `Erase ${person.first_name} ${person.last_name}'s personal data?`,
      message:
        'Their name, phone and photo are permanently scrubbed, and their emergency contacts and documents are deleted. Shift, leave and timesheet history is kept but no longer shows who it belonged to. This cannot be undone.',
      confirmLabel: 'Erase permanently',
      tone: 'danger',
    });
    if (!ok) return;
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

  const actionsFrom = (person: StaffProfile): StaffAction[] => {
    const actions: StaffAction[] = [
      {
        id: 'profile',
        label: 'View full profile',
        icon: IdCard,
        onSelect: () => void navigate(`/app/team/${person.id}`),
      },
      {
        id: 'edit',
        label: 'Edit details',
        icon: Pencil,
        onSelect: () => {
          setEditingStaff(person);
          setModalOpen(true);
        },
      },
      {
        id: 'pay-rate',
        label: 'Pay rate',
        icon: Banknote,
        onSelect: () => setPayRateFor(person),
      },
      {
        id: 'emergency',
        label: 'Emergency contacts',
        icon: Siren,
        onSelect: () => setEmergencyContactsFor(person),
      },
      {
        id: 'documents',
        label: 'Documents',
        icon: FileText,
        onSelect: () => setDocumentsFor(person),
      },
      {
        id: 'active',
        label: person.active ? 'Deactivate' : 'Reactivate',
        description: person.active
          ? 'Hides them from rotas without deleting history'
          : undefined,
        icon: person.active ? UserRoundX : UserRoundCheck,
        onSelect: () => void toggleActive(person),
      },
    ];

    if (canManageOrg) {
      actions.push(
        {
          id: 'export',
          label: 'Export their data',
          description: 'GDPR subject-access request',
          icon: Download,
          disabled: gdprBusyId === person.id,
          onSelect: () => void handleExportData(person),
        },
        {
          id: 'erase',
          label: 'Erase personal data',
          description: 'GDPR erasure. Cannot be undone',
          icon: ShieldOff,
          tone: 'danger',
          disabled: gdprBusyId === person.id,
          onSelect: () => void handleAnonymize(person),
        },
      );
    }

    return actions;
  };

  const openActions = (row: TeamRow): void => {
    if (!canManageStaff) return;
    setActionsFor(staff.find((person) => person.id === row.id) ?? null);
  };

  /**
   * Import a checked spreadsheet (CAP-084).
   *
   * Only the rows with no problems are sent. The skipped ones stay on screen
   * in the modal, which is the point of the preview — an import that quietly
   * took 57 of 60 people and said "done" is how a shift goes uncovered.
   *
   * The department is matched by name, case-insensitively, because that is
   * what the spreadsheet has. An unmatched name imports the person with no
   * department rather than refusing them: a department is a filter, not an
   * identity.
   */
  const handleImport = async (preview: ImportPreview): Promise<number> => {
    if (!orgId) return 0;

    const byName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
    const rows: StaffProfileInsert[] = preview.rows
      .filter((row) => row.problems.length === 0)
      .map((row) => ({
        org_id: orgId,
        first_name: row.values.firstName,
        last_name: row.values.lastName,
        email: row.values.email,
        job_title: row.values.jobTitle,
        department_id: row.values.department
          ? (byName.get(row.values.department.toLowerCase()) ?? null)
          : null,
        contract_type: row.values.contractType,
        weekly_hours: row.values.weeklyHours,
        payroll_id: row.values.payrollId,
        start_date: row.values.startDate,
        phone: row.values.phone,
      }));

    const created = await createStaffProfiles(rows);
    await load();
    return created.length;
  };

  const handleExport = (): void => {
    downloadCsv(`rotaflow-team-${todayIso}`, filtered, [
      { label: 'Name', value: (r) => `${r.firstName} ${r.lastName}` },
      { label: 'Job title', value: (r) => r.jobTitle ?? '' },
      { label: 'Department', value: (r) => r.department },
      { label: 'Site', value: (r) => r.location },
      { label: 'Contract', value: (r) => r.contractHoursLabel },
      { label: 'Rostered this week', value: (r) => r.rosteredHoursLabel },
      { label: 'Today', value: (r) => r.todayStatus },
    ]);
  };

  return (
    <div>
      {error && (
        <p className="mb-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Loading…
        </p>
      ) : (
        <TeamDirectoryView
          orgName={orgName ?? 'your organisation'}
          tiles={tiles}
          search={search}
          onSearchChange={setSearch}
          departmentId={departmentId}
          onDepartmentChange={setDepartmentId}
          locationId={locationId}
          onLocationChange={setLocationId}
          departments={departments}
          locations={locations}
          rows={filtered}
          totalRowCount={allRows.filter((r) => r.active).length}
          emptyMessage="Nobody matches these filters."
          onOpenActions={openActions}
          onExport={handleExport}
          onAddStaff={
            canManageStaff
              ? () => {
                  setEditingStaff(null);
                  setModalOpen(true);
                }
              : undefined
          }
          onImportStaff={canManageStaff ? () => setImportOpen(true) : undefined}
        />
      )}

      <StaffActionsModal
        open={Boolean(actionsFor)}
        staffName={actionsFor ? `${actionsFor.first_name} ${actionsFor.last_name}` : ''}
        actions={actionsFor ? actionsFrom(actionsFor) : []}
        onClose={() => setActionsFor(null)}
      />

      {orgId && payRateFor && user && (
        <PayRateModal
          open={Boolean(payRateFor)}
          onClose={() => setPayRateFor(null)}
          orgId={orgId}
          staffProfileId={payRateFor.id}
          staffName={`${payRateFor.first_name} ${payRateFor.last_name}`}
          createdBy={user.id}
        />
      )}

      <ImportStaffModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        existingEmails={staff.map((s) => s.email).filter((e): e is string => Boolean(e))}
        departments={departments}
        onImport={handleImport}
      />

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
