import { useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { StaffDirectoryView } from '@/components/staff/StaffDirectoryView';
import { StaffInvitationsView } from '@/components/staff/StaffInvitationsView';
import {
  StaffWorkspaceHeader,
  type StaffWorkspaceTab,
} from '@/components/staff/StaffWorkspaceHeader';
import type { StaffFilterSelect } from '@/components/staff/StaffFilterBar';
import type { StaffSort } from '@/components/staff/StaffTable';
import { DEMO_STAFF, DEMO_STAFF_DETAILS, DEMO_STATS } from '@/lib/staffDemo';
import {
  DEMO_INVITES,
  DEMO_INVITE_LINK,
  DEMO_INVITE_STATS,
  EMPTY_INVITE_STATS,
} from '@/lib/invitesDemo';
import { INVITE_ROLE_LABELS } from '@/lib/staffInvites';
import type { MembershipRole } from '@/types';

/**
 * Design-loop preview only — `/app/staff` needs a real Supabase session and a
 * seeded organisation. This renders the same components against the fixtures in
 * `src/lib/staffDemo.ts`, reproducing design/staff.png. Not wired to any
 * service call; see design/.loop/staff-log.md.
 *
 * `/staff-preview/invitations` opens the second tab, which has no reference
 * PNG — see design/.loop/staff-invitations-log.md. Its two other states only
 * exist transiently in the product, so `?state=empty` and `?state=link` render
 * them for the loop, the way `/onboarding-preview?step=` does.
 */
export function StaffPreviewPage(): JSX.Element {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const tab: StaffWorkspaceTab = pathname.endsWith('/invitations')
    ? 'invitations'
    : 'directory';
  const state = params.get('state');

  const [inviteSearch, setInviteSearch] = useState('');
  const [inviteRole, setInviteRole] = useState('');
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

  const inviteSelects: StaffFilterSelect[] = [
    {
      id: 'roles',
      allLabel: 'All Roles',
      value: inviteRole,
      onChange: setInviteRole,
      options: (['staff', 'manager', 'owner'] as MembershipRole[]).map((value) => ({
        value,
        label: INVITE_ROLE_LABELS[value],
      })),
    },
  ];

  const noop = (): void => {};

  return (
    <div className="min-h-screen bg-background px-8 py-6 dark:bg-background-dark">
      <StaffWorkspaceHeader tab={tab} basePath="/staff-preview" />

      {tab === 'invitations' ? (
        <StaffInvitationsView
          stats={state === 'empty' ? EMPTY_INVITE_STATS : DEMO_INVITE_STATS}
          rows={state === 'empty' ? [] : DEMO_INVITES}
          total={state === 'empty' ? 0 : DEMO_INVITES.length}
          search={inviteSearch}
          onSearchChange={setInviteSearch}
          selects={inviteSelects}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          link={state === 'link' ? DEMO_INVITE_LINK : null}
          onCopyLink={noop}
          onDismissLink={noop}
          onInvite={noop}
          onRevoke={noop}
          empty={state === 'empty'}
        />
      ) : (
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
      )}
    </div>
  );
}
