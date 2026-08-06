import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { DepartmentsView } from '@/components/locations/DepartmentsView';
import { LocationsView } from '@/components/locations/LocationsView';
import {
  LocationsWorkspaceHeader,
  type LocationsWorkspaceTab,
} from '@/components/locations/LocationsWorkspaceHeader';
import type { SiteFilterSelect } from '@/components/locations/SiteFilterBar';
import type { SiteSort } from '@/components/locations/SiteTableHeader';
import {
  DEMO_DEPARTMENTS,
  DEMO_DEPARTMENT_DETAILS,
  DEMO_DEPARTMENT_STATS,
  DEMO_DEPARTMENT_TOTAL,
  DEMO_LOCATIONS,
  DEMO_LOCATION_DETAILS,
  DEMO_LOCATION_STATS,
  DEMO_LOCATION_TOTAL,
} from '@/lib/locationsDemo';

/**
 * Design-loop preview only, `/app/locations` needs a real Supabase session and
 * a seeded organisation. This renders the same components against the fixtures
 * in `src/lib/locationsDemo.ts`, reproducing design/Locations-Management.png
 * and design/Location-department.png. Not wired to any service call; see
 * design/.loop/locations-log.md.
 *
 * `/locations-preview/departments` opens the second half.
 */
export function LocationsPreviewPage(): JSX.Element {
  const { pathname } = useLocation();
  const tab: LocationsWorkspaceTab = pathname.endsWith('/departments')
    ? 'departments'
    : 'locations';

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [region, setRegion] = useState('');
  const [location, setLocation] = useState('');
  const [sort, setSort] = useState<SiteSort | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(
    'sunnyvale-care-home',
  );
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>('nursing');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const noop = (): void => {};

  const statusSelect: SiteFilterSelect = {
    id: 'statuses',
    allLabel: 'All Statuses',
    value: status,
    onChange: setStatus,
    options: [
      { value: 'active', label: 'Active' },
      { value: 'maintenance', label: 'Maintenance' },
      { value: 'inactive', label: 'Inactive' },
    ],
  };

  const locationSelects: SiteFilterSelect[] = [
    statusSelect,
    {
      id: 'types',
      allLabel: 'All Location Types',
      value: type,
      onChange: setType,
      widthClass: 'w-48',
      options: [
        { value: 'care-home', label: 'Care Home' },
        { value: 'day-centre', label: 'Day Centre' },
        { value: 'domiciliary', label: 'Domiciliary' },
        { value: 'hospice', label: 'Hospice' },
      ],
    },
    {
      id: 'regions',
      allLabel: 'All Regions',
      value: region,
      onChange: setRegion,
      options: [
        { value: 'south-west', label: 'South West' },
        { value: 'south-east', label: 'South East' },
      ],
    },
  ];

  const departmentSelects: SiteFilterSelect[] = [
    {
      id: 'locations',
      allLabel: 'All Locations',
      value: location,
      onChange: setLocation,
      options: [
        { value: 'sunnyvale', label: 'Sunnyvale Care Home' },
        { value: 'oakview', label: 'Oakview Day Centre' },
        { value: 'meadowbank', label: 'Meadowbank Hospice' },
      ],
    },
    statusSelect,
    {
      id: 'types',
      allLabel: 'All Department Types',
      value: type,
      onChange: setType,
      widthClass: 'w-52',
      options: [
        { value: 'clinical', label: 'Clinical' },
        { value: 'allied-health', label: 'Allied Health' },
        { value: 'support', label: 'Support' },
        { value: 'corporate', label: 'Corporate' },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background px-5 py-6 dark:bg-background-dark">
      <LocationsWorkspaceHeader tab={tab} basePath="/locations-preview" />

      {tab === 'locations' ? (
        <LocationsView
          stats={DEMO_LOCATION_STATS}
          rows={DEMO_LOCATIONS}
          total={DEMO_LOCATION_TOTAL}
          search={search}
          onSearchChange={setSearch}
          selects={locationSelects}
          sort={sort}
          onSortChange={setSort}
          selectedId={selectedLocation}
          onSelect={setSelectedLocation}
          onCloseDetails={() => setSelectedLocation(null)}
          onEdit={noop}
          onOpenActions={noop}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          details={selectedLocation ? DEMO_LOCATION_DETAILS : null}
          onMoreFilters={noop}
          onAddLocation={noop}
          onEditInfo={noop}
          onFollowMetric={noop}
          onViewActivity={noop}
          onOpenGuide={noop}
        />
      ) : (
        <DepartmentsView
          stats={DEMO_DEPARTMENT_STATS}
          rows={DEMO_DEPARTMENTS}
          total={DEMO_DEPARTMENT_TOTAL}
          search={search}
          onSearchChange={setSearch}
          selects={departmentSelects}
          sort={sort}
          onSortChange={setSort}
          selectedId={selectedDepartment}
          onSelect={setSelectedDepartment}
          onEdit={noop}
          onOpenActions={noop}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          details={selectedDepartment ? DEMO_DEPARTMENT_DETAILS : null}
          onMoreFilters={noop}
          onAddDepartment={noop}
          onFollowMetric={noop}
          onViewActivity={noop}
          onQuickAction={noop}
        />
      )}
    </div>
  );
}
