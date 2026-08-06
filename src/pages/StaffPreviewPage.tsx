import { useState } from 'react';
import { StaffDirectoryView } from '@/components/staff/StaffDirectoryView';
import type { StaffFilterSelect } from '@/components/staff/StaffFilterBar';
import type { StaffSort } from '@/components/staff/StaffTable';
import { DEMO_STAFF, DEMO_STAFF_DETAILS, DEMO_STATS } from '@/lib/staffDemo';

/**
 * Design-loop preview only, `/app/staff` needs a real Supabase session and a
 * seeded organisation. This renders the same components against the fixtures in
 * `src/lib/staffDemo.ts`, reproducing design/staff.png. Not wired to any
 * service call; see design/.loop/staff-log.md.
 */
export function StaffPreviewPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [department, setDepartment] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<StaffSort | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>('sarah-johnson');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const selects: StaffFilterSelect[] = [
    {
      id: 'locations',
      allLabel: 'All Locations',
      value: location,
      onChange: setLocation,
      options: [
        { value: 'sunshine', label: 'Sunshine Care Home' },
        { value: 'riverside', label: 'Riverside House' },
        { value: 'oakview', label: 'Oakview Care Home' },
      ],
    },
    {
      id: 'departments',
      allLabel: 'All Departments',
      value: department,
      onChange: setDepartment,
      widthClass: 'w-44',
      options: [
        { value: 'nursing', label: 'Nursing' },
        { value: 'care', label: 'Care' },
      ],
    },
    {
      id: 'roles',
      allLabel: 'All Roles',
      value: role,
      onChange: setRole,
      options: [
        { value: 'senior-nurse', label: 'Senior Nurse' },
        { value: 'care-assistant', label: 'Care Assistant' },
      ],
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

  const noop = (): void => {};

  return (
    <div className="min-h-screen bg-background px-8 py-6 dark:bg-background-dark">
      <div className="mb-10">
        <h1 className="font-display text-3xl font-bold text-content dark:text-content-dark">
          Staff
        </h1>
        <p className="mt-1.5 text-sm text-content-muted dark:text-content-muted-dark">
          Manage your team, roles, departments and availability.
        </p>
      </div>

      <StaffDirectoryView
        stats={DEMO_STATS}
        rows={DEMO_STAFF}
        total={DEMO_STATS.totalStaff}
        search={search}
        onSearchChange={setSearch}
        selects={selects}
        sort={sort}
        onSortChange={setSort}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onOpenActions={noop}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        details={DEMO_STAFF_DETAILS}
        onMoreFilters={noop}
        onAddStaff={noop}
        onEditDetails={noop}
        onViewSkills={noop}
        onViewCalendar={noop}
        onViewDocuments={noop}
      />
    </div>
  );
}
