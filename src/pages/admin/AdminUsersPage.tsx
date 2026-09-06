import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import { Pagination } from '@/components/ui/Pagination';
import {
  DataTable,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/ui/DataTable';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import { setPlatformAdmin } from '@/services/platformService';
import {
  getUserFacets,
  listUserDirectory,
  listUserDirectoryAll,
  type UserDirectoryQuery,
  type UserDirectoryRow,
  type UserFacets,
} from '@/services/platformDirectoryService';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { reportError } from '@/lib/sentry';
import { useFilterState } from '@/hooks/useFilterState';
import { FilterBar } from '@/components/ui/FilterBar';
import { filterValue, filterValues } from '@/lib/filters';
import type { FilterDimension, FilterOption } from '@/lib/filters';
import { DEFAULT_PAGE_SIZE, type ServerPage } from '@/lib/serverPage';
import { humaniseKey } from '@/lib/platformOverview';
import { downloadCsv } from '@/lib/csv';
import {
  getAuthFactsSummary,
  type AuthFactsSummary,
} from '@/services/platformFactsService';
import { PLATFORM_ROLE_LABELS } from '@/lib/platformRoles';
import type { PlatformRole } from '@/types';

type UserSortKey =
  'name' | 'organisations' | 'role' | 'access' | 'status' | 'created_at' | 'actions';

/**
 * `/admin/users`. NEW_STRUCTURE §34's platform users.
 *
 * ## This screen did not work before 0015
 *
 * `profiles` RLS was still 0001's own-row-only policy, so `listAllProfiles()`
 * returned exactly one row. The reader's own, and the toggle wrote to zero
 * rows and got back a 204 with no error. It rendered a one-account table and a
 * button that reported success and changed nothing. 0015 widens the read to
 * platform administrators and moves the write onto RPCs that enforce their
 * rules in the database.
 *
 * ## And it could not find a multi-organisation account
 *
 * The search matched `soleOrgName`, which the membership summary set only for
 * an account belonging to exactly one organisation. So searching by
 * organisation could not find anybody in two — which is the kind of account a
 * support case is most often about, and the kind somebody is most likely to be
 * confused by. `platform_user_directory` (0131) searches every organisation an
 * account belongs to, and filters, sorts, pages and counts in the database, so
 * the totals are the match set rather than the length of whatever PostgREST
 * chose to return.
 *
 * The one write here is still the most dangerous switch in the product: it
 * grants read access to every tenant's data. So it confirms, it says what it
 * grants in plain words, and it refuses to strand the platform, a rule now
 * held in `revoke_platform_role` as well as here, because a guard that lives
 * only in the browser is not a guard.
 */

/**
 * The dimensions this screen filters on, on the shared contract.
 *
 * `q` is deliberately NOT marked sensitive, unlike the workspace's person
 * search. This list is platform administration: an account's email is how a
 * support case identifies it, it is already in the ticket, and a linkable
 * filtered view is the point of a console. The workspace's search is a
 * colleague's name inside one tenant, which is a different thing.
 *
 * `role` and `membership` are `multi`: an account can hold a role in several
 * organisations, and the OR-within-a-dimension rule is what makes "owner or
 * manager anywhere" expressible. Combined with an organisation, though, they
 * are AND-ed *within one membership* by the database — "owner at Beta" must
 * not match somebody who owns Alpha and merely belongs to Beta.
 */
const USER_FILTERS: readonly FilterDimension[] = [
  { id: 'q', label: 'Search', kind: 'text' },
  { id: 'access', label: 'Platform access', kind: 'select' },
  { id: 'role', label: 'Organisation role', kind: 'multi' },
  { id: 'membership', label: 'Membership', kind: 'multi' },
] as const;

const ACCESS_OPTIONS: readonly FilterOption[] = [
  { value: 'platform', label: 'Platform administrators' },
  { value: 'standard', label: 'Standard accounts' },
] as const;

const MEMBERSHIP_OPTIONS: readonly FilterOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'invited', label: 'Invited' },
  { value: 'suspended', label: 'Suspended' },
] as const;

export function AdminUsersPage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const { canManagePlatformAdmins } = usePermissions();
  const { showError, showSuccess } = useToast();
  const { confirm } = useConfirm();

  const [page, setPage] = useState<ServerPage<UserDirectoryRow> | null>(null);
  const [facets, setFacets] = useState<UserFacets | null>(null);
  const [authFacts, setAuthFacts] = useState<AuthFactsSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * Filters and sort in the URL, on the shared contract
   * (`src/lib/filters.ts`), so this screen and the organisation workspace
   * behave the same way.
   *
   * `scopeKey` is fixed: this list is every account on the deployment rather
   * than one tenant's, so there is no scope to switch and nothing to prune.
   */
  const filterApi = useFilterState({
    dimensions: USER_FILTERS,
    scopeKey: 'platform',
    defaultSort: 'created_at',
    defaultDirection: 'desc',
  });
  const { filters, sort, direction, page: pageNumber } = filterApi;

  const query = useMemo<UserDirectoryQuery>(
    () => ({
      search: filterValue(filters, 'q') || undefined,
      platformAccess: filterValue(filters, 'access') || undefined,
      roles: filterValues(filters, 'role').length
        ? [...filterValues(filters, 'role')]
        : undefined,
      membershipStatus: filterValues(filters, 'membership').length
        ? [...filterValues(filters, 'membership')]
        : undefined,
      sort: sort || 'created_at',
      direction,
      page: pageNumber,
      pageSize: DEFAULT_PAGE_SIZE,
    }),
    [filters, sort, direction, pageNumber],
  );

  /**
   * Ignore a reply a newer request has overtaken.
   *
   * Typing in the search box fires a request per keystroke and they do not
   * return in order, so without this the answer to "sar" can be painted over
   * by the answer to "sa".
   */
  const requestRef = useRef(0);

  useEffect(() => {
    const ticket = ++requestRef.current;
    setFailed(false);
    void (async () => {
      try {
        const [rows, estate, auth] = await Promise.all([
          listUserDirectory(query),
          getUserFacets(),
          // Email confirmation, last sign-in and MFA live in `auth.users`,
          // which no client may select from. 0027's definer function is the
          // narrow window onto exactly those three columns. It cannot reject
          // the screen: the account list is worth showing without them.
          getAuthFactsSummary().catch((err: unknown) => {
            reportError(err, { area: 'admin:users:auth-facts' });
            return null;
          }),
        ]);
        if (ticket !== requestRef.current) return;
        setPage(rows);
        setFacets(estate);
        setAuthFacts(auth);
      } catch (err) {
        if (ticket !== requestRef.current) return;
        reportError(err, { area: 'admin:users' });
        setFailed(true);
      }
    })();
  }, [query, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  const handleToggle = useCallback(
    async (row: UserDirectoryRow): Promise<void> => {
      const granting = !row.isPlatformAdmin;
      const who = row.fullName ?? row.email;

      const ok = await confirm({
        title: granting
          ? `Grant platform administrator to ${who}?`
          : `Remove platform administrator from ${who}?`,
        message: granting
          ? 'They will be able to read data belonging to every organisation on RotaFlow, including staff records and rotas. They are granted the Platform Support role. The most limited one, and can be promoted from the administrators roster. Grant this only to people who support the platform itself.'
          : 'They will lose access to the platform administration area and to other organisations’ data. Their own organisation membership is unchanged.',
        confirmLabel: granting ? 'Grant access' : 'Remove access',
        tone: 'danger',
      });
      if (!ok) return;

      setBusyId(row.id);
      try {
        await setPlatformAdmin(row.id, granting);
        showSuccess(granting ? 'Platform access granted.' : 'Platform access removed.');
        // Re-read rather than patch the row in place. The grant changes the
        // platform-admin count that gates every other row's button, and a
        // local edit would leave that count stale until the next reload.
        setReloadKey((k) => k + 1);
      } catch (err) {
        reportError(err, { area: 'admin:set-platform-admin' });
        // Surface the database's own refusal rather than a generic failure:
        // "Only a platform owner can grant platform roles" and "Cannot revoke
        // the last platform owner" both tell the reader what to do next, and
        // "Please try again" tells them to repeat something that cannot work.
        showError(
          err instanceof Error && err.message
            ? err.message
            : 'Could not change that. Please try again.',
        );
      } finally {
        setBusyId(null);
      }
    },
    [confirm, showError, showSuccess],
  );

  const optionsFor = useCallback(
    (dimensionId: string): readonly FilterOption[] => {
      switch (dimensionId) {
        case 'access':
          return ACCESS_OPTIONS;
        case 'membership':
          return MEMBERSHIP_OPTIONS;
        case 'role':
          // From the estate, not from the loaded page: a role only older
          // accounts hold was never offered by a list built from the first
          // twenty-five rows.
          return (facets?.roles ?? []).map((role) => ({
            value: role,
            label: humaniseKey(role),
          }));
        default:
          return [];
      }
    },
    [facets],
  );

  const tableSort = useMemo<DataTableSort<UserSortKey> | null>(
    () => (sort ? { key: sort as UserSortKey, direction } : null),
    [sort, direction],
  );

  const onSortChange = useCallback(
    (next: DataTableSort<UserSortKey>) => filterApi.setSort(next.key, next.direction),
    [filterApi],
  );

  const rows = page?.rows ?? [];

  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const all = await listUserDirectoryAll(query);
      downloadCsv(`platform-users_${new Date().toISOString().slice(0, 10)}`, all.rows, [
        { label: 'Name', value: (row) => row.fullName ?? '' },
        { label: 'Email', value: (row) => row.email },
        { label: 'Organisations', value: (row) => row.organisations },
        { label: 'Active memberships', value: (row) => row.activeMemberships },
        { label: 'Organisation names', value: (row) => row.orgNames.join('; ') },
        { label: 'Organisation roles', value: (row) => row.roles.join('; ') },
        {
          label: 'Platform role',
          value: (row) =>
            !row.isPlatformAdmin
              ? 'Standard'
              : row.platformRole
                ? (PLATFORM_ROLE_LABELS[row.platformRole as PlatformRole] ??
                  row.platformRole)
                : 'Platform administrator',
        },
        { label: 'Joined (UTC)', value: (row) => row.createdAt },
      ]);
      if (all.truncated) {
        showError(
          `Exported the first ${all.rows.length.toLocaleString('en-GB')} of ${all.total.toLocaleString('en-GB')} matching accounts. Narrow the filters to export the rest.`,
        );
      } else {
        showSuccess(
          `Exported ${all.rows.length.toLocaleString('en-GB')} accounts, timestamps in UTC.`,
        );
      }
    } catch (err) {
      reportError(err, { area: 'admin:users:export' });
      showError('The export could not be built. Nothing was downloaded.');
    } finally {
      setExporting(false);
    }
  }, [query, showError, showSuccess]);

  const columns = useMemo<DataTableColumn<UserDirectoryRow, UserSortKey>[]>(
    () => [
      {
        key: 'name',
        label: 'User',
        width: 'w-[24%]',
        sortable: true,
        cell: (row) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-primary/20 bg-primary-wash text-[0.65rem] font-semibold text-primary-ink dark:bg-primary-wash-dark dark:text-primary-ink-dark">
              {(row.fullName ?? row.email)
                .split(/[\s@.]+/)
                .slice(0, 2)
                .map((w) => w[0])
                .join('')
                .toUpperCase()}
            </span>
            <span className="min-w-0">
              <Link
                to={`/admin/users/${row.id}`}
                className="block truncate font-medium text-content hover:text-primary dark:text-content-dark"
              >
                {row.fullName ?? row.email}
                {row.id === user?.id && (
                  <span className="ml-1.5 text-xs font-normal text-content-muted dark:text-content-muted-dark">
                    (you)
                  </span>
                )}
              </Link>
              <span className="block truncate text-xs text-content-muted dark:text-content-muted-dark">
                {row.email}
              </span>
            </span>
          </span>
        ),
      },
      {
        key: 'organisations',
        label: 'Organisations',
        width: 'w-[20%]',
        sortable: true,
        // Every organisation, named. The old cell showed one name only when
        // there was exactly one and otherwise "2 organisations", which is
        // the same omission that made the search unable to find them.
        cell: (row) => {
          if (row.organisations === 0) {
            return (
              <span className="text-content-muted dark:text-content-muted-dark">
                No membership
              </span>
            );
          }
          return (
            <span className="block min-w-0">
              <span className="block truncate text-content dark:text-content-dark">
                {row.orgNames.join(', ')}
              </span>
              {row.organisations > 1 && (
                <span className="block text-xs text-content-muted dark:text-content-muted-dark">
                  {row.organisations} organisations
                </span>
              )}
            </span>
          );
        },
      },
      {
        key: 'role',
        label: 'Org roles',
        width: 'w-[10%]',
        // Not sortable: an account holds a set of roles, and sorting by the
        // alphabetically first one is an order nobody asked for. Filter by
        // role instead, which is the question this column answers.
        cell: (row) =>
          row.roles.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {row.roles.map((role) => (
                <Badge key={role} tone="neutral">
                  {humaniseKey(role)}
                </Badge>
              ))}
            </span>
          ) : (
            <span className="text-content-muted dark:text-content-muted-dark">-</span>
          ),
      },
      {
        key: 'access',
        label: 'Platform role',
        width: 'w-[15%]',
        sortable: true,
        cell: (row) => {
          if (!row.isPlatformAdmin) {
            return (
              <span className="text-content-muted dark:text-content-muted-dark">
                Standard
              </span>
            );
          }
          const role = row.platformRole as PlatformRole | null;
          return (
            <Badge tone="info" dot>
              {role ? (PLATFORM_ROLE_LABELS[role] ?? role) : 'Platform administrator'}
            </Badge>
          );
        },
      },
      {
        key: 'status',
        label: 'Membership',
        width: 'w-[13%]',
        cell: (row) => {
          // Per-account verification and MFA live in `auth.users` and cost
          // one round trip each, so they are on the account's own screen.
          // What this column says is membership state, and it now says
          // something true: the old test was `roles.length === 0`, which no
          // membership row can satisfy, so the "no active membership" badge
          // was unreachable and every account read "Active".
          if (row.organisations === 0) {
            return (
              <Badge tone="neutral" dot>
                Unattached
              </Badge>
            );
          }
          return row.activeMemberships > 0 ? (
            <Badge tone="success" dot>
              {row.activeMemberships === row.organisations
                ? 'Active'
                : `Active in ${row.activeMemberships} of ${row.organisations}`}
            </Badge>
          ) : (
            <Badge tone="warning" dot>
              No active membership
            </Badge>
          );
        },
      },
      {
        key: 'actions',
        label: 'Actions',
        width: 'w-[18%]',
        align: 'right',
        cell: (row) => {
          const isSelf = row.id === user?.id;
          // The last-administrator guard reads the estate-wide count, not
          // the loaded page. Counting administrators in the visible rows was
          // wrong the moment the list was filtered or paged — on page two of
          // a filtered view it would have offered to revoke the only one.
          const wouldStrandPlatform =
            row.isPlatformAdmin && (isSelf || (facets?.platformAdmins ?? 0) <= 1);
          const disabled =
            busyId === row.id || wouldStrandPlatform || !canManagePlatformAdmins;
          return (
            <span className="flex justify-end gap-1.5">
              <Link
                to={`/admin/users/${row.id}`}
                className="rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-content hover:bg-surface-subtle dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
              >
                View
              </Link>
              {/* The reference's second action is "Reset". Granting or removing
                  platform access is the dangerous switch this screen actually
                  owns, so that is what sits here, a password reset would need
                  the Auth Admin API, which a static client cannot call. */}
              <button
                type="button"
                disabled={disabled}
                title={
                  !canManagePlatformAdmins
                    ? 'Only a platform owner can change platform roles'
                    : wouldStrandPlatform
                      ? isSelf
                        ? 'You cannot remove your own platform access'
                        : 'This is the only platform administrator'
                      : undefined
                }
                onClick={() => void handleToggle(row)}
                className="rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-content hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
              >
                {row.isPlatformAdmin ? 'Revoke' : 'Grant'}
              </button>
            </span>
          );
        },
      },
    ],
    [user?.id, facets, busyId, canManagePlatformAdmins, handleToggle],
  );

  const loading = page === null && !failed;

  return (
    <AdminPage
      title="Users"
      description="Every account across every organisation. Platform roles are separate from organisation membership and are shown in their own column."
      action={
        <Button
          variant="secondary"
          onClick={() => void exportCsv()}
          disabled={exporting || (page?.total ?? 0) === 0}
        >
          <Download size={15} aria-hidden="true" />
          {exporting ? 'Exporting…' : 'Export'}
        </Button>
      }
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : loading || !facets ? (
        <AdminLoading />
      ) : (
        <div className="space-y-4">
          <TileGrid>
            <StatTile label="Total users" value={facets.total.toLocaleString('en-GB')} />
            {/* From `platform_auth_facts_summary`, which reads auth.users
                through a definer function. Null when the call was refused or
                failed, and the tiles then say so rather than showing a zero
                that reads as "nobody has signed in". */}
            <StatTile
              label="Active, 30 days"
              value={authFacts ? authFacts.active30d.toLocaleString('en-GB') : '-'}
              hint={
                authFacts && authFacts.totalAccounts > 0
                  ? `${Math.round((authFacts.active30d / authFacts.totalAccounts) * 100)}% of all accounts`
                  : 'Signed in at least once in the last 30 days'
              }
            />
            <StatTile
              label="Unverified"
              value={authFacts ? authFacts.unverified.toLocaleString('en-GB') : '-'}
              hint={
                authFacts && authFacts.unverified > 0 ? (
                  <span className="font-semibold text-danger-ink dark:text-danger-ink-dark">
                    Email never confirmed
                  </span>
                ) : (
                  'Every address confirmed'
                )
              }
            />
            <StatTile
              label="MFA enrolled"
              value={authFacts ? authFacts.mfaEnrolled.toLocaleString('en-GB') : '-'}
              hint={
                authFacts && authFacts.mfaEnrolled === 0 ? (
                  <span className="font-semibold text-warning-ink dark:text-warning-ink-dark">
                    Nobody, including staff
                  </span>
                ) : (
                  'Verified factor on the account'
                )
              }
            />
            <StatTile
              label="In several organisations"
              value={facets.multiOrg}
              hint="Findable by any of their organisation names"
            />
            <StatTile
              label="Platform admins"
              value={facets.platformAdmins}
              hint="Can read every tenant"
            />
          </TileGrid>

          <Card className="p-0">
            <div className="border-b border-divider p-3 dark:border-divider-dark">
              <FilterBar
                dimensions={USER_FILTERS}
                filters={filters}
                optionsFor={optionsFor}
                onSetValue={filterApi.setValue}
                onSetValues={filterApi.setValues}
                onClearOne={filterApi.clearOne}
                onClearAll={filterApi.clearAll}
                searchPlaceholder="Search name, email or organisation"
                resultSummary={
                  page === null
                    ? 'Loading'
                    : page.total === 0
                      ? `0 of ${facets.total.toLocaleString('en-GB')}`
                      : `${page.from.toLocaleString('en-GB')}–${page.to.toLocaleString('en-GB')} of ${page.total.toLocaleString('en-GB')}`
                }
              />
            </div>

            <DataTable
              caption="Accounts with a RotaFlow profile"
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              sort={tableSort}
              onSortChange={onSortChange}
              emptyMessage="No account matches these filters."
              tableClassName="min-w-[64rem]"
            />

            {page && (
              <Pagination
                page={page.page}
                pageCount={page.pageCount}
                total={page.total}
                from={page.from}
                to={page.to}
                onPageChange={filterApi.setPage}
                noun="accounts"
              />
            )}
          </Card>

          <p className="text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
            Active, unverified and MFA come from <code>auth.users</code> through a definer
            function that returns those facts and nothing else. They are totals rather
            than a column, because reading them per account is one round trip each and a
            table of two hundred users would make two hundred of them. One account&rsquo;s
            own facts are on its detail screen.
          </p>
        </div>
      )}
    </AdminPage>
  );
}
