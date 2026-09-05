import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { addDays, startOfDay, startOfMonth } from 'date-fns';
import { useOrg } from '@/hooks/useOrg';
import { getStaffProfile, updateStaffProfile } from '@/services/staffService';
import { listDepartments, listLocations } from '@/services/locationService';
import { listDocuments } from '@/services/documentService';
import { listEmergencyContacts } from '@/services/emergencyContactService';
import { listMyLeaveRequests } from '@/services/leaveService';
import { listShiftsForPeriod } from '@/services/shiftService';
import { StaffProfileView } from '@/components/staff/StaffProfileView';
import { StaffFormModal, type StaffFormValues } from '@/components/staff/StaffFormModal';
import { EmergencyContactsModal } from '@/components/staff/EmergencyContactsModal';
import { DocumentsModal } from '@/components/staff/DocumentsModal';
import { toStaffDocument } from '@/lib/staffDirectoryMapping';
import { buildProfile } from '@/lib/staffProfileMapping';
import { reportError } from '@/lib/sentry';
import type { StaffProfileTab } from '@/lib/staffProfile';
import type {
  Department,
  EmergencyContact,
  LeaveRequest,
  Location,
  Shift,
  StaffDocument as DocumentRow,
  StaffProfile,
} from '@/types';

/**
 * One person's profile (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.staffDetail`). Skill competency levels and shift ratings the
 * schema does not carry are omitted rather than filled with placeholders.
 */
export function StaffProfilePage(): JSX.Element {
  const { staffId } = useParams<{ staffId: string }>();
  const { orgId } = useOrg();
  const navigate = useNavigate();

  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [leave, setLeave] = useState<LeaveRequest[]>([]);
  const [upcoming, setUpcoming] = useState<Shift[]>([]);
  const [thisMonth, setThisMonth] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<StaffProfileTab>('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [emergencyContactsOpen, setEmergencyContactsOpen] = useState(false);

  const today = useMemo(() => new Date(), []);

  const load = useCallback(async (): Promise<void> => {
    if (!orgId || !staffId) return;
    setLoading(true);
    try {
      const [
        profile,
        deptRows,
        locationRows,
        documentRows,
        contactRows,
        leaveRows,
        shiftRows,
        monthRows,
      ] = await Promise.all([
        getStaffProfile(staffId),
        listDepartments(orgId),
        listLocations(orgId),
        listDocuments(orgId, staffId),
        listEmergencyContacts(orgId, staffId),
        listMyLeaveRequests(staffId),
        listShiftsForPeriod({
          orgId,
          fromIso: startOfDay(today).toISOString(),
          toIso: addDays(startOfDay(today), 28).toISOString(),
          staffProfileId: staffId,
        }),
        listShiftsForPeriod({
          orgId,
          fromIso: startOfMonth(today).toISOString(),
          toIso: startOfDay(today).toISOString(),
          staffProfileId: staffId,
        }),
      ]);
      setStaff(profile);
      setDepartments(deptRows);
      setLocations(locationRows);
      setDocuments(documentRows);
      setEmergencyContacts(contactRows);
      setLeave(leaveRows);
      setUpcoming(shiftRows);
      setThisMonth(monthRows);
    } catch (err) {
      reportError(err, { area: 'staff-profile:load' });
      setError('Could not load this staff profile.');
    } finally {
      setLoading(false);
    }
  }, [orgId, staffId, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const profile = useMemo(
    () =>
      staff
        ? buildProfile({
            staff,
            departments,
            locations,
            upcoming,
            thisMonth,
            documents: documents.map((row) => toStaffDocument(row, today)),
            emergencyContacts,
            leave,
            today,
          })
        : null,
    [
      staff,
      departments,
      locations,
      upcoming,
      thisMonth,
      documents,
      emergencyContacts,
      leave,
      today,
    ],
  );

  const handleSubmit = async (values: StaffFormValues): Promise<void> => {
    if (!staff || !orgId) return;
    const updated = await updateStaffProfile(staff.id, {
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
    });
    setStaff(updated);
  };

  const onAction = (action: string): void => {
    if (action === 'edit' || action.startsWith('edit-')) setEditOpen(true);
    else if (action === 'view-schedule') void navigate('/app/schedule');
    else if (action === 'view-timesheet') void navigate('/app/timesheets');
    else if (action === 'message') void navigate('/app/announcements');
  };

  if (loading) {
    return (
      <p className="text-sm text-content-muted dark:text-content-muted-dark">Loading…</p>
    );
  }

  if (error || !profile) {
    return (
      <p className="text-sm text-danger-ink dark:text-danger-ink-dark" role="alert">
        {error ?? 'That staff member could not be found.'}
      </p>
    );
  }

  return (
    <div>
      <StaffProfileView
        profile={profile}
        tab={tab}
        onTabChange={setTab}
        backTo="/app/team"
        onAction={onAction}
        onUploadDocument={() => setDocumentsOpen(true)}
        onAddEmergencyContact={() => setEmergencyContactsOpen(true)}
      />

      <StaffFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSubmit={handleSubmit}
        departments={departments}
        locations={locations}
        initial={staff}
      />

      {orgId && staff && (
        <DocumentsModal
          open={documentsOpen}
          onClose={() => {
            setDocumentsOpen(false);
            void load();
          }}
          orgId={orgId}
          staffProfileId={staff.id}
          staffName={`${staff.first_name} ${staff.last_name}`}
        />
      )}

      {orgId && staff && (
        <EmergencyContactsModal
          open={emergencyContactsOpen}
          onClose={() => {
            setEmergencyContactsOpen(false);
            void load();
          }}
          orgId={orgId}
          staffProfileId={staff.id}
          staffName={`${staff.first_name} ${staff.last_name}`}
        />
      )}
    </div>
  );
}
