import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import {
  createLocation,
  listDepartments,
  listLocations,
  listMinimumCoverRulesForOrg,
  updateLocation,
} from '@/services/locationService';
import { listActiveStaff } from '@/services/staffService';
import { Modal } from '@/components/ui/Modal';
import { DepartmentManager } from '@/components/locations/DepartmentManager';
import { LocationsView } from '@/components/locations/LocationsView';
import { MinimumCoverEditor } from '@/components/locations/MinimumCoverEditor';
import {
  LocationFormModal,
  type LocationFormValues,
} from '@/components/locations/LocationFormModal';
import { toLocationRow } from '@/lib/locationsDirectoryMapping';
import { reportError } from '@/lib/sentry';
import type {
  Department,
  Location,
  LocationInsert,
  MinimumCoverRule,
  StaffProfile,
} from '@/types';

function toInsert(orgId: string, values: LocationFormValues): LocationInsert {
  return {
    org_id: orgId,
    name: values.name.trim(),
    address: values.address.trim() || null,
    location_type: values.locationType || null,
    status: values.status,
    latitude: values.latitude ? Number(values.latitude) : null,
    longitude: values.longitude ? Number(values.longitude) : null,
    timezone: values.timezone,
    geofence_radius_m: values.geofenceRadiusM ? Number(values.geofenceRadiusM) : 150,
  };
}

/**
 * `/app/locations` (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.locations`).
 *
 * The reference's own "Departments" and "Minimum cover" card buttons are
 * placeholders (`onclick="toast(...)"`); this app has real screens behind
 * both already (`DepartmentManager`, `MinimumCoverEditor`, 0036), so they
 * open as dialogs instead of a toast that says nothing happened.
 */
export function LocationsPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canManageStaff } = usePermissions();

  const [locations, setLocations] = useState<Location[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [coverRules, setCoverRules] = useState<MinimumCoverRule[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [departmentsFor, setDepartmentsFor] = useState<string | null>(null);
  const [minimumCoverFor, setMinimumCoverFor] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [locationRows, departmentRows, staffRows, ruleRows] = await Promise.all([
        listLocations(orgId),
        listDepartments(orgId),
        listActiveStaff(orgId),
        listMinimumCoverRulesForOrg(orgId),
      ]);
      setLocations(locationRows);
      setDepartments(departmentRows);
      setStaff(staffRows);
      setCoverRules(ruleRows);
    } catch (err) {
      reportError(err, { area: 'locations:load' });
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeRefresh({
    // minimum_cover_rules is not published to Realtime (see RealtimeTable);
    // its editor already reloads on close, which covers the same-session case.
    tables: ['locations', 'departments'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => void load(),
  });

  const rows = useMemo(
    () => locations.map((l) => toLocationRow(l, departments, staff, coverRules)),
    [locations, departments, staff, coverRules],
  );

  const handleSubmit = async (values: LocationFormValues): Promise<void> => {
    if (!orgId) return;
    if (editing) {
      const updated = await updateLocation(editing.id, toInsert(orgId, values));
      setLocations((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    } else {
      const created = await createLocation(toInsert(orgId, values));
      setLocations((prev) => [...prev, created]);
    }
  };

  return (
    <div>
      <LocationsView
        rows={rows}
        loading={loading}
        canManage={canManageStaff}
        onAddLocation={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        onEditLocation={(id) => {
          setEditing(locations.find((l) => l.id === id) ?? null);
          setFormOpen(true);
        }}
        onOpenDepartments={setDepartmentsFor}
        onOpenMinimumCover={setMinimumCoverFor}
      />

      <LocationFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
        initial={editing}
      />

      <Modal
        open={departmentsFor !== null}
        onClose={() => {
          setDepartmentsFor(null);
          void load();
        }}
        title={`Departments, ${locations.find((l) => l.id === departmentsFor)?.name ?? 'Site'}`}
      >
        {orgId && departmentsFor && (
          <DepartmentManager orgId={orgId} locationId={departmentsFor} />
        )}
      </Modal>

      <Modal
        open={minimumCoverFor !== null}
        onClose={() => {
          setMinimumCoverFor(null);
          void load();
        }}
        title={`Minimum cover, ${locations.find((l) => l.id === minimumCoverFor)?.name ?? 'Site'}`}
      >
        {orgId && minimumCoverFor && (
          <MinimumCoverEditor
            orgId={orgId}
            locationId={minimumCoverFor}
            canEdit={canManageStaff}
          />
        )}
      </Modal>
    </div>
  );
}
