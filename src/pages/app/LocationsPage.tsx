import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
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
import { Button } from '@/components/ui/Button';
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
  /**
   * `/app/locations/:locationId` (NEW_STRUCTURE §34) is the same workspace with
   * one site opened, not a second implementation of it. Reusing the page keeps
   * one set of tabs, one data load and one place to fix a bug; a parallel
   * detail screen would drift from this one within a release.
   */
  const { locationId: routeLocationId } = useParams<{ locationId: string }>();
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(
    routeLocationId ?? null,
  );
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [locationFilter, setLocationFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [departmentsModalFor, setDepartmentsModalFor] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [withStaffOnly, setWithStaffOnly] = useState(false);
  const [withShiftsOnly, setWithShiftsOnly] = useState(false);

  /**
   * Picking a different site keeps the URL honest, but only when the URL was
   * already naming one. On `/app/locations` the selection is a panel, not a
   * destination, and pushing a history entry per click would make Back walk
   * the list instead of leaving the screen.
   */
  const handleSelectLocation = useCallback(
    (id: string): void => {
      setSelectedLocationId(id);
      if (routeLocationId && id !== routeLocationId) {
        void navigate(`/app/locations/${id}`, { replace: true });
      }
    },
    [routeLocationId, navigate],
  );

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
      // A URL-named site wins over "first in the list": arriving on
      // /app/locations/<id> must open that site, not whichever sorts first.
      // Falls back to the first row when the id is unknown — a stale bookmark
      // to a deleted site should still land somewhere usable.
      setSelectedLocationId((current) => {
        if (routeLocationId && locationRows.some((l) => l.id === routeLocationId)) {
          return routeLocationId;
        }
        return current ?? locationRows[0]?.id ?? null;
      });
      setSelectedDepartmentId((current) => current ?? departmentRows[0]?.id ?? null);
    } catch (err) {
      reportError(err, { area: 'locations:load' });
    } finally {
      setLoading(false);
    }
  }, [orgId, routeLocationId]);

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
        .filter((row) => !withStaffOnly || row.staff > 0)
        .filter((row) => !withShiftsOnly || row.upcomingShifts > 0)
        .sort((a, b) => compare(a, b, sort)),
    [locationRows, search, withStaffOnly, withShiftsOnly, sort],
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
      .filter((row) => !withStaffOnly || row.staff > 0)
      .filter((row) => !withShiftsOnly || row.upcomingShifts > 0)
      .sort((a, b) => compare(a, b, sort));
  }, [
    departmentRows,
    departments,
    locationFilter,
    search,
    withStaffOnly,
    withShiftsOnly,
    sort,
  ]);

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

  // react-router v7's `navigate` returns `void | Promise<void>`; these are
  // fire-and-forget, so the result is explicitly discarded.
  const goTo = (path: string): void => {
    void navigate(path);
  };

  const goToStaff = (): void => goTo('/app/team');

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
          onSelect={handleSelectLocation}
          onCloseDetails={() => {
            setSelectedLocationId(null);
            // Leaving the detail route when its subject is dismissed, so the
            // URL never names a site that is no longer open.
            if (routeLocationId) void navigate('/app/locations');
          }}
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
          onMoreFilters={() => setFiltersOpen(true)}
          onAddLocation={canManageStaff ? openCreate : undefined}
          onEditInfo={() =>
            selectedLocationId ? openEdit(selectedLocationId) : undefined
          }
          onFollowMetric={(id) => {
            if (id === 'staff') goToStaff();
            if (id === 'departments') goTo('/app/locations/departments');
          }}
          onViewActivity={() => goTo('/app/settings/audit')}
          onOpenGuide={() => setGuideOpen(true)}
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
          onMoreFilters={() => setFiltersOpen(true)}
          onAddDepartment={canManageStaff ? () => openDepartments() : undefined}
          onFollowMetric={(id) => {
            if (id === 'staff') goToStaff();
          }}
          onViewActivity={() => goTo('/app/settings/audit')}
          onQuickAction={(action) => {
            if (action === 'directory') goToStaff();
            if (action === 'add' || action === 'settings') openDepartments();
          }}
        />
      )}

      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="More filters"
      >
        <div className="space-y-4">
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-content dark:text-content-dark">
            <input
              type="checkbox"
              checked={withStaffOnly}
              onChange={(e) => {
                setWithStaffOnly(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-surface-border text-primary focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
            />
            Only show ones with staff assigned
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-content dark:text-content-dark">
            <input
              type="checkbox"
              checked={withShiftsOnly}
              onChange={(e) => {
                setWithShiftsOnly(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-surface-border text-primary focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
            />
            Only show ones with upcoming shifts
          </label>
          {/* Status, type and region are in the reference but are not columns
              (docs/SCHEMA.md §3), so they are absent rather than faked. */}
          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            Status, site type and region are not recorded against a location, so they
            cannot be filtered on yet.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setWithStaffOnly(false);
                setWithShiftsOnly(false);
                setPage(1);
              }}
            >
              Clear
            </Button>
            <Button onClick={() => setFiltersOpen(false)}>Done</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Locations and departments"
      >
        <div className="space-y-4 text-sm text-content dark:text-content-dark">
          <div>
            <h3 className="mb-1 font-semibold">How the two relate</h3>
            <p className="text-content-muted dark:text-content-muted-dark">
              A location is a physical site with its own address and timezone. A
              department belongs to one location and is what staff are actually assigned
              to — so someone&rsquo;s site is inferred from their department.
            </p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">Why timezone matters</h3>
            <p className="text-content-muted dark:text-content-muted-dark">
              Shift times are stored as instants and displayed in the location&rsquo;s
              timezone, not the viewer&rsquo;s. A manager in one country sees a
              site&rsquo;s 07:00 start as 07:00 local to that site. Set it correctly when
              adding a location — changing it later moves how every existing shift reads.
            </p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">Coverage</h3>
            <p className="text-content-muted dark:text-content-muted-dark">
              Coverage compares assigned shifts against the total scheduled for the
              period. It does not know a required headcount — no such column exists — so
              it reports how much of what was planned is filled, not whether the plan was
              adequate.
            </p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">Archiving</h3>
            <p className="text-content-muted dark:text-content-muted-dark">
              Deleting a location detaches its shifts and departments rather than
              destroying them, so historical rotas and timesheets stay intact.
            </p>
          </div>
        </div>
      </Modal>

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
