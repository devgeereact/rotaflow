import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download,
  FileText,
  IdCard,
  Pencil,
  ShieldOff,
  Siren,
  UserRoundCheck,
  UserRoundX,
} from 'lucide-react';
import { addDays, format, startOfDay, startOfWeek } from 'date-fns';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import {
  createStaffProfile,
  deactivateStaffProfile,
  listStaff,
  reactivateStaffProfile,
  updateStaffProfile,
} from '@/services/staffService';
import { listDepartments, listLocations } from '@/services/locationService';
import { listOrgAvailability } from '@/services/availabilityService';
import { listOrgLeaveRequests } from '@/services/leaveService';
import { listShiftsForPeriod } from '@/services/shiftService';
import { listDocuments } from '@/services/documentService';
import { anonymizeStaffMember, exportStaffData } from '@/services/gdprService';
import { StaffDirectoryView } from '@/components/staff/StaffDirectoryView';
import type { StaffFilterSelect } from '@/components/staff/StaffFilterBar';
import type { StaffSort } from '@/components/staff/StaffTable';
import {
  StaffActionsModal,
  type StaffAction,
} from '@/components/staff/StaffActionsModal';
import { EmergencyContactsModal } from '@/components/staff/EmergencyContactsModal';
import { DocumentsModal } from '@/components/staff/DocumentsModal';
import { StaffFormModal, type StaffFormValues } from '@/components/staff/StaffFormModal';
import {
  buildStats,
  onLeaveToday,
  toDirectoryRow,
  toStaffDetails,
} from '@/lib/staffDirectoryMapping';
import { downloadJson } from '@/lib/csv';
import { reportError } from '@/lib/sentry';
import type { StaffDirectoryRow, StaffDirectoryStats } from '@/lib/staffDirectory';
import type {
  Availability,
  Department,
  LeaveRequest,
  Location,
  Shift,
  StaffDocument as DocumentRow,
  StaffProfile,
  StaffProfileInsert,
} from '@/types';

const EMPTY_STATS: StaffDirectoryStats = {
  totalStaff: 0,
  onShiftToday: 0,
  onLeaveToday: 0,
  unavailableToday: 0,
  vacancies: 0,
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

function compareRows(
  a: StaffDirectoryRow,
  b: StaffDirectoryRow,
  sort: StaffSort,
): number {
  const value = (row: StaffDirectoryRow): string | number => {
    switch (sort.key) {
      case 'staff':
        return `${row.lastName} ${row.firstName}`.toLowerCase();
      case 'role':
        return row.role.toLowerCase();
      case 'department':
        return row.department.toLowerCase();
      case 'location':
        return row.location.toLowerCase();
      case 'skills':
        return row.skills.length;
      case 'availability':
        return row.availabilityPercent;
      case 'status':
        return row.status;
    }
  };
  const left = value(a);
  const right = value(b);
  const order = left < right ? -1 : left > right ? 1 : 0;
  return sort.direction === 'asc' ? order : -order;
}

/**
 * The Staff Directory (design/staff.png). Everything the screen shows is
 * derived from Supabase and scoped to the active org; RLS is the real gate,
 * `usePermissions` only decides which affordances appear.
 */
export function StaffPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canManageStaff, canManageOrg } = usePermissions();
  const navigate = useNavigate();

  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [leave, setLeave] = useState<LeaveRequest[]>([]);
  const [shiftsToday, setShiftsToday] = useState<Shift[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<StaffSort | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
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
      const [staffRows, deptRows, locationRows, availabilityRows, leaveRows, shiftRows] =
        await Promise.all([
          listStaff(orgId, { includeInactive: true }),
          listDepartments(orgId),
          listLocations(orgId),
          listOrgAvailability(orgId),
          listOrgLeaveRequests(orgId),
          listShiftsForPeriod({
            orgId,
            fromIso: startOfDay(today).toISOString(),
            toIso: addDays(startOfDay(today), 1).toISOString(),
          }),
        ]);
      setStaff(staffRows);
      setDepartments(deptRows);
      setLocations(locationRows);
      setAvailability(availabilityRows);
      setLeave(leaveRows);
      setShiftsToday(shiftRows);
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

  const onLeave = useMemo(() => onLeaveToday(leave, todayIso), [leave, todayIso]);

  const context = useMemo(
    () => ({ departments, locations, availability, onLeaveIds: onLeave }),
    [departments, locations, availability, onLeave],
  );

  const allRows = useMemo(
    () => staff.map((person) => toDirectoryRow(person, context)),
    [staff, context],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = allRows.filter((row) => {
      if (term) {
        const haystack =
          `${row.firstName} ${row.lastName} ${row.role} ${row.skills.join(' ')}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (locationId && row.location !== locationId) return false;
      if (departmentId && row.department !== departmentId) return false;
      if (role && row.role !== role) return false;
      if (status && row.status !== status) return false;
      return true;
    });
    return sort ? [...rows].sort((a, b) => compareRows(a, b, sort)) : rows;
  }, [allRows, search, locationId, departmentId, role, status, sort]);

  const pageRows = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );

  // Keep a selection alive across filtering so the panel never blanks out.
  const selected = useMemo(
    () =>
      staff.find((person) => person.id === selectedId) ??
      staff.find((person) => person.id === pageRows[0]?.id) ??
      null,
    [staff, selectedId, pageRows],
  );

  useEffect(() => {
    if (!orgId || !selected) {
      setDocuments([]);
      return;
    }
    let cancelled = false;
    void listDocuments(orgId, selected.id)
      .then((rows) => {
        if (!cancelled) setDocuments(rows);
      })
      .catch((err: unknown) => {
        reportError(err, { area: 'staff:documents' });
        if (!cancelled) setDocuments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, selected]);

  const stats = useMemo(
    () =>
      staff.length === 0
        ? EMPTY_STATS
        : buildStats(staff, shiftsToday, onLeave, availability, today),
    [staff, shiftsToday, onLeave, availability, today],
  );

  const details = useMemo(() => {
    if (!selected) return null;
    return toStaffDetails(
      selected,
      context,
      documents,
      selected.payroll_id ?? '—',
      startOfWeek(today, { weekStartsOn: 1 }),
      today,
    );
  }, [selected, context, documents, today]);

  const selects: StaffFilterSelect[] = [
    {
      id: 'locations',
      allLabel: 'All Locations',
      value: locationId,
      onChange: setLocationId,
      options: locations.map((l) => ({ value: l.name, label: l.name })),
    },
    {
      id: 'departments',
      allLabel: 'All Departments',
      value: departmentId,
      onChange: setDepartmentId,
      widthClass: 'w-44',
      options: departments.map((d) => ({ value: d.name, label: d.name })),
    },
    {
      id: 'roles',
      allLabel: 'All Roles',
      value: role,
      onChange: setRole,
      options: [...new Set(allRows.map((row) => row.role))]
        .filter((title) => title !== '—')
        .map((title) => ({ value: title, label: title })),
    },
    {
      id: 'statuses',
      allLabel: 'All Statuses',
      value: status,
      onChange: setStatus,
      options: [
        { value: 'active', label: 'Active' },
        { value: 'on_leave', label: 'On Leave' },
        { value: 'inactive', label: 'Inactive' },
      ],
    },
  ];

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

  const actionsFrom = (person: StaffProfile): StaffAction[] => {
    const actions: StaffAction[] = [
      {
        id: 'profile',
        label: 'View full profile',
        icon: IdCard,
        onSelect: () => navigate(`/app/staff/${person.id}`),
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
          description: 'GDPR erasure — cannot be undone',
          icon: ShieldOff,
          tone: 'danger',
          disabled: gdprBusyId === person.id,
          onSelect: () => void handleAnonymize(person),
        },
      );
    }

    return actions;
  };

  const openActions = (id: string): void => {
    if (!canManageStaff) return;
    setActionsFor(staff.find((person) => person.id === id) ?? null);
  };

  const clearFilters = (): void => {
    setSearch('');
    setLocationId('');
    setDepartmentId('');
    setRole('');
    setStatus('');
    setPage(1);
  };

  const editSelected = (): void => {
    if (!selected) return;
    setEditingStaff(selected);
    setModalOpen(true);
  };

  return (
    <div>
      <div className="mb-10">
        <h1 className="font-display text-3xl font-bold text-content dark:text-content-dark">
          Staff
        </h1>
        <p className="mt-1.5 text-sm text-content-muted dark:text-content-muted-dark">
          Manage your team, roles, departments and availability.
        </p>
      </div>

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
        <StaffDirectoryView
          stats={stats}
          rows={pageRows}
          total={filtered.length}
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          selects={selects}
          sort={sort}
          onSortChange={setSort}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          onOpenActions={openActions}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          details={details}
          onMoreFilters={clearFilters}
          onAddStaff={
            canManageStaff
              ? () => {
                  setEditingStaff(null);
                  setModalOpen(true);
                }
              : undefined
          }
          onEditDetails={editSelected}
          onViewSkills={editSelected}
          onViewCalendar={() => navigate('/app/availability')}
          onViewDocuments={() => selected && setDocumentsFor(selected)}
        />
      )}

      <StaffActionsModal
        open={Boolean(actionsFor)}
        staffName={actionsFor ? `${actionsFor.first_name} ${actionsFor.last_name}` : ''}
        actions={actionsFor ? actionsFrom(actionsFor) : []}
        onClose={() => setActionsFor(null)}
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
