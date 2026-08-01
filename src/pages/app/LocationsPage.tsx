import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { addDays } from 'date-fns';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import {
  createLocation,
  listDepartments,
  listLocations,
  updateLocation,
} from '@/services/locationService';
import { listActiveStaff } from '@/services/staffService';
import { listShiftsForPeriod } from '@/services/shiftService';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { DepartmentManager } from '@/components/locations/DepartmentManager';
import { DepartmentsView } from '@/components/locations/DepartmentsView';
import { LocationsView } from '@/components/locations/LocationsView';
import {
  LocationsWorkspaceHeader,
  type LocationsWorkspaceTab,
} from '@/components/locations/LocationsWorkspaceHeader';
import type { SiteFilterSelect } from '@/components/locations/SiteFilterBar';
import type { SiteSort } from '@/components/locations/SiteTableHeader';
import {
  LocationFormModal,
  type LocationFormValues,
} from '@/components/locations/LocationFormModal';
import {
  buildDepartmentStats,
  buildLocationStats,
  toDepartmentDetails,
  toDepartmentRow,
  toLocationDetails,
  toLocationRow,
} from '@/lib/locationsDirectoryMapping';
import { reportError } from '@/lib/sentry';
import type { DepartmentRow, LocationRow } from '@/lib/locationsDirectory';
import type { Department, Location, LocationInsert, Shift, StaffProfile } from '@/types';

/** The coverage window both references label "Upcoming Shifts (7 days)". */
const WINDOW_DAYS = 7;

function toInsert(orgId: string, values: LocationFormValues): LocationInsert {
  return {
    org_id: orgId,
    name: values.name.trim(),
    address: values.address.trim() || null,
    latitude: values.latitude ? Number(values.latitude) : null,
    longitude: values.longitude ? Number(values.longitude) : null,
    timezone: values.timezone,
    geofence_radius_m: values.geofenceRadiusM ? Number(values.geofenceRadiusM) : 150,
  };
}

function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.trim().toLowerCase());
}

function compare<T extends LocationRow | DepartmentRow>(
  a: T,
  b: T,
  sort: SiteSort | null,
): number {
  if (!sort) return 0;
  const direction = sort.direction === 'asc' ? 1 : -1;
  return a.name.localeCompare(b.name) * direction;
}

/**
 * Locations & Departments — one workspace, two tabs, reproducing
 * design/Locations-Management.png and design/Location-department.png.
 *
 * Coverage, staff counts and upcoming-shift counts are derived from real
 * `shifts` / `staff_profiles` / `departments` rows over the next seven days;
 * the type, region, capacity and activity columns the references show have no
 * database column and render empty. See `src/lib/locationsDirectoryMapping.ts`.
 */
export function LocationsPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canManageStaff } = usePermissions();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Which half is showing comes from the URL, not from state — see
  // `LocationsWorkspaceHeader`.
  const tab: LocationsWorkspaceTab = pathname.endsWith('/departments')
    ? 'departments'
    : 'locations';

  const [locations, setLocations] = useState<Location[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SiteSort | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [locationFilter, setLocationFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [departmentsModalFor, setDepartmentsModalFor] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    setLoading(true);
    try {
      const now = new Date();
      const [locationRows, departmentRows, staffRows, shiftRows] = await Promise.all([
        listLocations(orgId),
        listDepartments(orgId),
        listActiveStaff(orgId),
        listShiftsForPeriod({
          orgId,
          fromIso: now.toISOString(),
          toIso: addDays(now, WINDOW_DAYS).toISOString(),
          publishedOnly: false,
        }),
      ]);
      setLocations(locationRows);
      setDepartments(departmentRows);
      setStaff(staffRows);
      setShifts(shiftRows);
      setSelectedLocationId((current) => current ?? locationRows[0]?.id ?? null);
      setSelectedDepartmentId((current) => current ?? departmentRows[0]?.id ?? null);
    } catch (err) {
      reportError(err, { area: 'locations:load' });
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live updates: refetch when someone else changes this data.
  useRealtimeRefresh({
    tables: ['locations', 'departments', 'shifts'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => void load(),
  });

  const locationRows = useMemo(
    () => locations.map((l) => toLocationRow(l, departments, staff, shifts)),
    [locations, departments, staff, shifts],
  );

  const departmentRows = useMemo(
    () => departments.map((d, i) => toDepartmentRow(d, i, locations, staff, shifts)),
    [departments, locations, staff, shifts],
  );

  const visibleLocations = useMemo(
    () =>
      locationRows
        .filter((row) => !search || matches(`${row.name} ${row.address}`, search))
        .sort((a, b) => compare(a, b, sort)),
    [locationRows, search, sort],
  );

  const visibleDepartments = useMemo(() => {
    const scoped = locationFilter
      ? new Set(
          departments.filter((d) => d.location_id === locationFilter).map((d) => d.id),
        )
      : null;
    return departmentRows
      .filter((row) => !scoped || scoped.has(row.id))
      .filter((row) => !search || matches(`${row.name} ${row.location}`, search))
      .sort((a, b) => compare(a, b, sort));
  }, [departmentRows, departments, locationFilter, search, sort]);

  const pageOf = <T,>(rows: T[]): T[] =>
    rows.slice((page - 1) * pageSize, page * pageSize);

  const locationDetails = useMemo(() => {
    const location = locations.find((l) => l.id === selectedLocationId);
    const row = locationRows.find((r) => r.id === selectedLocationId);
    return location && row ? toLocationDetails(location, row, departments, shifts) : null;
  }, [locations, locationRows, selectedLocationId, departments, shifts]);

  const departmentDetails = useMemo(() => {
    const department = departments.find((d) => d.id === selectedDepartmentId);
    const row = departmentRows.find((r) => r.id === selectedDepartmentId);
    return department && row ? toDepartmentDetails(department, row, shifts) : null;
  }, [departments, departmentRows, selectedDepartmentId, shifts]);

  // The references also offer status / type / region selects. None of those are
  // columns (docs/SCHEMA.md §3), so only the filters we can actually apply ship.
  const locationSelects: SiteFilterSelect[] = [];
  const departmentSelects: SiteFilterSelect[] = [
    {
      id: 'locations',
      allLabel: 'All Locations',
      value: locationFilter,
      widthClass: 'w-48',
      onChange: (value) => {
        setLocationFilter(value);
        setPage(1);
      },
      options: locations.map((l) => ({ value: l.id, label: l.name })),
    },
  ];

  const handleSubmit = async (values: LocationFormValues): Promise<void> => {
    if (!orgId) return;
    if (editing) {
      const updated = await updateLocation(editing.id, toInsert(orgId, values));
      setLocations((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    } else {
      const created = await createLocation(toInsert(orgId, values));
      setLocations((prev) => [...prev, created]);
      setSelectedLocationId(created.id);
    }
  };

  const openCreate = (): void => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (id: string): void => {
    setEditing(locations.find((l) => l.id === id) ?? null);
    setModalOpen(true);
  };

  const goToStaff = (): void => navigate('/app/staff');

  /**
   * `DepartmentManager` is per-site inline CRUD and predates this screen. It
   * moves into a dialog here so the Departments tab keeps every capability the
   * old two-column page had — add, rename, delete — without breaking the
   * reference layout. Departments with no `location_id` stay unmanageable, as
   * they were before.
   */
  const openDepartments = (departmentId?: string): void => {
    const scoped = departmentId
      ? departments.find((d) => d.id === departmentId)?.location_id
      : null;
    setDepartmentsModalFor(scoped ?? (locationFilter || locations[0]?.id) ?? null);
  };

  return (
    <div>
      <LocationsWorkspaceHeader tab={tab} basePath="/app/locations" />

      {loading ? (
        <Card>
          <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
        </Card>
      ) : tab === 'locations' ? (
        <LocationsView
          stats={buildLocationStats(locationRows)}
          rows={pageOf(visibleLocations)}
          total={visibleLocations.length}
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          selects={locationSelects}
          sort={sort}
          onSortChange={setSort}
          selectedId={selectedLocationId}
          onSelect={setSelectedLocationId}
          onCloseDetails={() => setSelectedLocationId(null)}
          onEdit={openEdit}
          onOpenActions={openEdit}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          details={locationDetails}
          onMoreFilters={() => undefined}
          onAddLocation={canManageStaff ? openCreate : undefined}
          onEditInfo={() =>
            selectedLocationId ? openEdit(selectedLocationId) : undefined
          }
          onFollowMetric={(id) => {
            if (id === 'staff') goToStaff();
            if (id === 'departments') navigate('/app/locations/departments');
          }}
          onViewActivity={() => undefined}
          onOpenGuide={() => undefined}
        />
      ) : (
        <DepartmentsView
          stats={buildDepartmentStats(departmentRows)}
          rows={pageOf(visibleDepartments)}
          total={visibleDepartments.length}
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          selects={departmentSelects}
          sort={sort}
          onSortChange={setSort}
          selectedId={selectedDepartmentId}
          onSelect={setSelectedDepartmentId}
          onEdit={openDepartments}
          onOpenActions={openDepartments}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          details={departmentDetails}
          onMoreFilters={() => undefined}
          onAddDepartment={canManageStaff ? () => openDepartments() : undefined}
          onFollowMetric={(id) => {
            if (id === 'staff') goToStaff();
          }}
          onViewActivity={() => undefined}
          onQuickAction={(action) => {
            if (action === 'directory') goToStaff();
            if (action === 'add' || action === 'settings') openDepartments();
          }}
        />
      )}

      <LocationFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        initial={editing}
      />

      <Modal
        open={departmentsModalFor !== null}
        onClose={() => {
          setDepartmentsModalFor(null);
          void load();
        }}
        title={`Departments — ${
          locations.find((l) => l.id === departmentsModalFor)?.name ?? 'Site'
        }`}
      >
        {orgId && departmentsModalFor && (
          <DepartmentManager orgId={orgId} locationId={departmentsModalFor} />
        )}
      </Modal>
    </div>
  );
}
