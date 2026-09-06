import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Download, Plus, Upload } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import { Pagination } from '@/components/ui/Pagination';
import {
  DataTable,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/ui/DataTable';
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPage,
} from '@/components/admin/AdminPage';
import { AdminCreateOrgModal } from '@/components/admin/AdminCreateOrgModal';
import type { CreatedOrganisationInvite } from '@/services/platformService';
import {
  getOrganisationFacets,
  listOrganisationDirectory,
  listOrganisationDirectoryAll,
  type OrganisationDirectoryQuery,
  type OrganisationDirectoryRow,
  type OrganisationFacets,
} from '@/services/platformDirectoryService';
import { sendInviteEmail } from '@/services/inviteService';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { useToast } from '@/hooks/useToast';
import { humaniseKey } from '@/lib/platformOverview';
import { HEALTH_LABEL, HEALTH_TONE } from '@/lib/tenantHealth';
import { downloadCsv } from '@/lib/csv';
import { reportError } from '@/lib/sentry';
import { useFilterState } from '@/hooks/useFilterState';
import { FilterBar } from '@/components/ui/FilterBar';
import { DEFAULT_PAGE_SIZE, type ServerPage } from '@/lib/serverPage';
import { CREATED_WINDOWS, organisationQueryFrom } from '@/lib/organisationDirectory';
import type { FilterDimension, FilterOption } from '@/lib/filters';
import type { OrganisationStatus } from '@/types';

type OrgSortKey =
  | 'name'
  | 'industry'
  | 'plan'
  | 'subscription_status'
  | 'members'
  | 'staff_active'
  | 'locations'
  | 'status'
  | 'health'
  | 'last_activity_at'
  | 'actions';

const STATUS_TONE: Record<OrganisationStatus, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  suspended: 'warning',
  archived: 'neutral',
};

/**
 * The console's filter dimensions, on the shared contract.
 *
 * `src/lib/filters.ts` was written to be shared and, until this screen adopted
 * it, only the organisation workspace used it — so a person moving between the
 * two met two sets of rules about what an empty select means, whether a filter
 * survives a reload, and whether "nothing here" means the query matched
 * nothing or failed.
 *
 * `q` is NOT marked sensitive here, unlike the workspace's person search: an
 * organisation's name and slug are the tenant's identity to platform staff,
 * they appear in every support ticket already, and a linkable filtered view is
 * the point of a console. The workspace's is a colleague's name, which is a
 * different thing entirely.
 *
 * Every one of these is applied by the database (`platform_organisation_directory`,
 * 0130), not to the rows that happened to load. That distinction is the whole
 * of this screen's repair: filtering an array PostgREST already truncated
 * finds three of the eleven tenants it matched, and says "no matches" for the
 * rest.
 */
const ORG_FILTERS: readonly FilterDimension[] = [
  { id: 'q', label: 'Search', kind: 'text' },
  { id: 'status', label: 'Status', kind: 'select' },
  { id: 'plan', label: 'Plan', kind: 'select' },
  { id: 'subscription', label: 'Subscription', kind: 'select' },
  { id: 'industry', label: 'Industry', kind: 'select' },
  { id: 'health', label: 'Health', kind: 'select' },
  { id: 'created', label: 'Created', kind: 'select' },
] as const;

const ORG_STATUS_OPTIONS: readonly FilterOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'archived', label: 'Archived' },
] as const;

/**
 * Subscription status is a different domain from organisation status, and the
 * option labels say so in words rather than relying on the reader to remember
 * which select they are in. An active organisation and an active subscription
 * are not the same fact, and `docs/DESIGN.md` is explicit that two status
 * domains keep their text labels for exactly that reason.
 */
const SUBSCRIPTION_OPTIONS: readonly FilterOption[] = [
  { value: 'trialing', label: 'Trialing' },
  { value: 'active', label: 'Subscribed' },
  { value: 'past_due', label: 'Past due' },
  { value: 'canceled', label: 'Cancelled' },
  // Selectable, because a tenant with no subscription row at all is a real
  // and interesting state that none of the four statuses can find.
  { value: 'none', label: 'No subscription' },
] as const;

const HEALTH_OPTIONS: readonly FilterOption[] = (
  ['healthy', 'attention', 'at_risk', 'suspended', 'archived'] as const
).map((band) => ({ value: band, label: HEALTH_LABEL[band] }));

/** `/admin/organisations`. NEW_STRUCTURE §34's tenant management. */
export function AdminOrganisationsPage(): JSX.Element {
  const [page, setPage] = useState<ServerPage<OrganisationDirectoryRow> | null>(null);
  const [facets, setFacets] = useState<OrganisationFacets | null>(null);
  const [failed, setFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<{
    orgName: string;
    email: string;
    url: string;
  } | null>(null);
  const { showSuccess, showError } = useToast();

  /**
   * Filters, sort and page in the URL.
   *
   * `scopeKey` is fixed: this list is the whole deployment rather than one
   * tenant, so there is no scope to switch and nothing to prune. It is passed
   * explicitly rather than omitted so the next person can see that the
   * question was asked.
   */
  const filterApi = useFilterState({
    dimensions: ORG_FILTERS,
    scopeKey: 'platform',
    defaultSort: 'created_at',
    defaultDirection: 'desc',
  });
  const { filters, sort, direction, page: pageNumber } = filterApi;

  const query = useMemo<OrganisationDirectoryQuery>(
    () =>
      organisationQueryFrom(filters, {
        sort,
        direction,
        page: pageNumber,
        pageSize: DEFAULT_PAGE_SIZE,
      }),
    [filters, sort, direction, pageNumber],
  );

  /**
   * Ignore a response that a newer request has already overtaken.
   *
   * Typing in the search box fires a request per keystroke, and they do not
   * come back in order. Without this, "sun" can be painted over by the reply
   * to "su" and the table shows results for a query the box no longer holds.
   * A counter rather than an `active` flag, because the stale reply has to be
   * identified, not merely the unmounted one.
   */
  const requestRef = useRef(0);

  useEffect(() => {
    const ticket = ++requestRef.current;
    setFailed(false);
    void (async () => {
      try {
        const [rows, estate] = await Promise.all([
          listOrganisationDirectory(query),
          getOrganisationFacets(),
        ]);
        if (ticket !== requestRef.current) return;
        setPage(rows);
        setFacets(estate);
      } catch (err) {
        if (ticket !== requestRef.current) return;
        reportError(err, { area: 'admin:organisations' });
        setFailed(true);
      }
    })();
  }, [query, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  const handleOrgCreated = useCallback(
    (result: CreatedOrganisationInvite, orgName: string, email: string) => {
      setCreateModalOpen(false);
      setCreatedInvite({ orgName, email, url: result.acceptUrl });
      setReloadKey((k) => k + 1);
      showSuccess(`${orgName} created.`);

      // Email the owner invite (GAP-005). This is the sales-led signup: the
      // recipient has never seen the product and is waiting on us, so leaving
      // delivery as "copy this link" made it a manual step somebody had to
      // remember, correctly, out of hours. `send-invite` shipped in 0058 and
      // this path was simply never wired to it — it could not be until 0084
      // returned the invite id, which the function needs to look the
      // invitation up before it will send anywhere.
      //
      // Best effort on top of a durable invite, the same posture every other
      // invite path takes: the organisation and the invitation both exist and
      // the link stays on screen, so a refused send is reported rather than
      // failing anything.
      void sendInviteEmail(result.orgId, {
        inviteId: result.inviteId,
        token: result.inviteToken,
        expiresAt: result.inviteExpiresAt,
        acceptUrl: result.acceptUrl,
      }).then((delivery) => {
        if (delivery.sent) {
          showSuccess(`Owner invite emailed to ${email}.`);
        } else {
          showError(
            delivery.reason ??
              `The invite to ${email} could not be emailed. Copy the link below and send it to them.`,
          );
        }
      });
    },
    [showError, showSuccess],
  );

  const copyInviteLink = useCallback(
    async (url: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(url);
        showSuccess('Invitation link copied.');
      } catch (err) {
        reportError(err, { area: 'admin:create-org:copy-link' });
        showError('Could not copy. Select the link and copy it manually.');
      }
    },
    [showError, showSuccess],
  );

  /**
   * The option lists come from the estate, not from the loaded page.
   *
   * The other half of the truncation fix. A plan or an industry that only
   * older tenants hold was never offered by a select built from the first
   * twenty-five rows, so the filter could not reach the records it existed
   * for.
   */
  const optionsFor = useCallback(
    (dimensionId: string): readonly FilterOption[] => {
      switch (dimensionId) {
        case 'status':
          return ORG_STATUS_OPTIONS;
        case 'subscription':
          return SUBSCRIPTION_OPTIONS;
        case 'health':
          return HEALTH_OPTIONS;
        case 'created':
          return CREATED_WINDOWS;
        case 'plan':
          return (facets?.plans ?? []).map((plan) => ({
            value: plan,
            label: humaniseKey(plan),
          }));
        case 'industry':
          return (facets?.industries ?? []).map((industry) => ({
            value: industry,
            label: humaniseKey(industry),
          }));
        default:
          return [];
      }
    },
    [facets],
  );

  const tableSort = useMemo<DataTableSort<OrgSortKey> | null>(
    () => (sort ? { key: sort as OrgSortKey, direction } : null),
    [sort, direction],
  );

  const onSortChange = useCallback(
    (next: DataTableSort<OrgSortKey>) => filterApi.setSort(next.key, next.direction),
    [filterApi],
  );

  const rows = page?.rows ?? [];

  /**
   * Export every matching row, not the page.
   *
   * The old export wrote `visible`, the array on screen. With filters applied
   * that array is a page of the answer, and a file named
   * `organisations_2026-09-06.csv` gives no hint which page. This re-runs the
   * same predicates to exhaustion and says so if it hit the walk's ceiling —
   * a truncated export that does not admit it is worse than none, because
   * nothing in the file says which rows are missing.
   */
  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const all = await listOrganisationDirectoryAll(query);
      downloadCsv(`organisations_${new Date().toISOString().slice(0, 10)}`, all.rows, [
        { label: 'Name', value: (org) => org.name },
        { label: 'Slug', value: (org) => org.slug },
        { label: 'Industry', value: (org) => org.industry ?? 'Not recorded' },
        { label: 'Plan', value: (org) => org.plan },
        { label: 'Status', value: (org) => org.status },
        {
          label: 'Subscription',
          value: (org) => org.subscriptionStatus ?? 'No subscription',
        },
        {
          label: 'Owner email',
          value: (org) =>
            org.ownerContactVisible
              ? (org.ownerEmail ?? 'No owner recorded')
              : 'Not available to your role',
        },
        { label: 'Login accounts', value: (org) => org.members },
        { label: 'Active staff', value: (org) => org.staffActive },
        { label: 'Sites', value: (org) => org.locations },
        { label: 'Health', value: (org) => HEALTH_LABEL[org.health] },
        { label: 'Last activity (UTC)', value: (org) => org.lastActivityAt ?? 'Never' },
        { label: 'Created (UTC)', value: (org) => org.createdAt },
      ]);
      if (all.truncated) {
        showError(
          `Exported the first ${all.rows.length.toLocaleString('en-GB')} of ${all.total.toLocaleString('en-GB')} matching organisations. Narrow the filters to export the rest.`,
        );
      } else {
        showSuccess(
          `Exported ${all.rows.length.toLocaleString('en-GB')} organisations, timestamps in UTC.`,
        );
      }
    } catch (err) {
      reportError(err, { area: 'admin:organisations:export' });
      showError('The export could not be built. Nothing was downloaded.');
    } finally {
      setExporting(false);
    }
  }, [query, showError, showSuccess]);

  const columns = useMemo<DataTableColumn<OrganisationDirectoryRow, OrgSortKey>[]>(
    () => [
      {
        key: 'name',
        label: 'Organisation',
        width: 'w-[19%]',
        sortable: true,
        cell: (org) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-primary/20 bg-primary-wash text-[0.65rem] font-semibold text-primary-ink dark:bg-primary-wash-dark dark:text-primary-ink-dark">
              {org.name
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0])
                .join('')
                .toUpperCase()}
            </span>
            <span className="min-w-0">
              <Link
                to={`/admin/organisations/${org.id}`}
                className="block truncate font-medium text-content hover:text-primary dark:text-content-dark"
              >
                {org.name}
              </Link>
              <span className="block truncate font-mono text-xs text-content-muted dark:text-content-muted-dark">
                {org.slug}
              </span>
              {/* The owner contact, where the reader's role may see it.
                  `ownerContactVisible` is false for platform finance (0122),
                  and "your role cannot see this" has to read differently
                  from "this tenant has no owner" — one is a permission and
                  the other is a problem with the account. */}
              <span className="block truncate text-xs text-content-muted dark:text-content-muted-dark">
                {org.ownerContactVisible
                  ? (org.ownerEmail ?? 'No owner recorded')
                  : 'Owner hidden for your role'}
              </span>
            </span>
          </span>
        ),
      },
      {
        key: 'plan',
        label: 'Plan',
        width: 'w-[12%]',
        sortable: true,
        // Plan and subscription state in one cell, with the subscription
        // spelled out underneath rather than badged beside it. An "Active"
        // badge in a Status column and an "Active" badge in a Subscription
        // column are two different facts, and a console that renders them
        // identically invites reading one as the other.
        cell: (org) => (
          <span className="block min-w-0">
            <Badge tone="neutral">{humaniseKey(org.plan)}</Badge>
            <span className="mt-1 block truncate text-xs text-content-muted dark:text-content-muted-dark">
              {org.subscriptionStatus === null
                ? 'No subscription'
                : org.subscriptionStatus === 'active'
                  ? 'Subscribed'
                  : org.subscriptionStatus === 'past_due'
                    ? 'Payment past due'
                    : humaniseKey(org.subscriptionStatus)}
            </span>
          </span>
        ),
      },
      {
        key: 'staff_active',
        label: 'Staff',
        width: 'w-[8%]',
        numeric: true,
        sortable: true,
        // Active staff profiles, which is the population `plans.seat_limit`
        // is enforced on (0070) and what the customer's own billing screen
        // counts. Login accounts are the next column and are a different and
        // usually much smaller population — most rostered staff never sign
        // in. Showing one under the other's name is BUG-062.
        cell: (org) => org.staffActive,
      },
      {
        key: 'members',
        label: 'Accounts',
        width: 'w-[11%]',
        numeric: true,
        sortable: true,
        cell: (org) => org.members,
      },
      {
        key: 'locations',
        label: 'Sites',
        width: 'w-[7%]',
        numeric: true,
        sortable: true,
        cell: (org) => org.locations,
      },
      {
        key: 'status',
        label: 'Status',
        width: 'w-[10%]',
        sortable: true,
        cell: (org) => (
          <Badge tone={STATUS_TONE[org.status as OrganisationStatus] ?? 'neutral'} dot>
            {humaniseKey(org.status)}
          </Badge>
        ),
      },
      {
        key: 'health',
        label: 'Health',
        width: 'w-[11%]',
        sortable: true,
        cell: (org) => (
          <Badge tone={HEALTH_TONE[org.health]} className="whitespace-nowrap">
            {HEALTH_LABEL[org.health]}
          </Badge>
        ),
      },
      // A "Usage %" column stood here. It was invented outright — RotaFlow has
      // no seat or shift ceiling to be a denominator, so there is no such
      // percentage to compute — and it was drawn as a progress bar that turned
      // amber past 90%, which is a specific and actionable-looking claim about
      // a tenant. It is removed rather than replaced with "Not available",
      // because the column measured nothing at all.
      {
        key: 'last_activity_at',
        label: 'Last activity',
        width: 'w-[13%]',
        sortable: true,
        // The real organisations.last_activity_at. A tenant the "At risk"
        // tile above counts as never-active (this same column) used to show
        // "today" one column across, and the two could never agree.
        cell: (org) => (
          <span className="whitespace-nowrap text-content-muted dark:text-content-muted-dark">
            {org.lastActivityAt
              ? new Date(org.lastActivityAt).toLocaleDateString('en-GB')
              : 'Never'}
          </span>
        ),
      },
      {
        key: 'actions',
        label: 'Actions',
        width: 'w-[9%]',
        align: 'right',
        cell: (org) => (
          <span className="flex justify-end gap-1.5">
            <Link
              to={`/admin/organisations/${org.id}`}
              className="rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-content hover:bg-surface-subtle dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
            >
              Open
            </Link>
          </span>
        ),
      },
    ],
    [],
  );

  const loading = page === null && !failed;

  return (
    <AdminPage
      title="Organisations"
      description="Every tenant on the deployment: lifecycle, plan, seat usage and the activity behind their health."
      action={
        <>
          <Button variant="secondary" disabled title="Bulk import is not built">
            <Upload size={15} aria-hidden="true" />
            Import
          </Button>
          <Button
            variant="secondary"
            onClick={() => void exportCsv()}
            disabled={exporting || (page?.total ?? 0) === 0}
          >
            <Download size={15} aria-hidden="true" />
            {exporting ? 'Exporting…' : 'Export'}
          </Button>
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus size={15} aria-hidden="true" />
            Add organisation
          </Button>
        </>
      }
    >
      {createdInvite && (
        <div className="mb-4 rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <h2 className="mb-1 font-medium text-content dark:text-content-dark">
            Invitation link for {createdInvite.email}
          </h2>
          <p className="mb-3 text-sm text-content-muted dark:text-content-muted-dark">
            {createdInvite.orgName} is created. Send this link to {createdInvite.email} so
            they can accept and become its owner. It is shown once — RotaFlow stores only
            a hash of the token, so it cannot be retrieved again.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-surface-border bg-background px-3 py-2 font-mono text-xs text-content dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark">
              {createdInvite.url}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void copyInviteLink(createdInvite.url)}
            >
              <Copy size={14} aria-hidden="true" className="mr-1.5" />
              Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreatedInvite(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {failed ? (
        <AdminError onRetry={retry} />
      ) : loading || !facets ? (
        <AdminLoading />
      ) : facets.total === 0 ? (
        <AdminEmpty message="No organisations have been created on this deployment yet." />
      ) : (
        <div className="space-y-4">
          <TileGrid>
            <StatTile label="Total" value={facets.total.toLocaleString('en-GB')} />
            <StatTile
              label="Active"
              value={facets.active.toLocaleString('en-GB')}
              hint={`${((facets.active / facets.total) * 100).toFixed(1)}% of tenants`}
            />
            <StatTile
              label="Trialing"
              value={facets.trialing}
              hint={
                facets.trialing === 0 ? 'No trial running' : 'Subscription not yet active'
              }
            />
            <StatTile
              label="Suspended"
              value={facets.suspended}
              hint={
                facets.suspended ? (
                  <span className="font-semibold text-danger-ink dark:text-danger-ink-dark">
                    Payment or abuse
                  </span>
                ) : (
                  'None'
                )
              }
            />
            <StatTile
              label="At risk"
              value={facets.atRisk}
              hint="No activity in 30 days, or never"
            />
            <StatTile
              label="New this month"
              value={facets.newThisMonth}
              hint={
                facets.newLastMonth === 0
                  ? facets.newThisMonth > 0
                    ? 'None last month'
                    : 'No prior month to compare'
                  : `${facets.newThisMonth >= facets.newLastMonth ? '+' : ''}${(
                      ((facets.newThisMonth - facets.newLastMonth) /
                        facets.newLastMonth) *
                      100
                    ).toFixed(0)}% vs last month`
              }
            />
          </TileGrid>

          <Card className="p-0">
            <div className="border-b border-divider p-3 dark:border-divider-dark">
              <FilterBar
                dimensions={ORG_FILTERS}
                filters={filters}
                optionsFor={optionsFor}
                onSetValue={filterApi.setValue}
                onSetValues={filterApi.setValues}
                onClearOne={filterApi.clearOne}
                onClearAll={filterApi.clearAll}
                searchPlaceholder="Search name, slug or contact"
                resultSummary={
                  page === null
                    ? 'Loading'
                    : page.total === 0
                      ? `0 of ${facets.total.toLocaleString('en-GB')}`
                      : `${page.from.toLocaleString('en-GB')}–${page.to.toLocaleString('en-GB')} of ${page.total.toLocaleString('en-GB')}`
                }
              />
            </div>

            {/* The table scrolls inside its own container so the page never
                does. The pattern §27 asks for on wide data. `DataTable` owns
                that, along with the sort affordance and the empty row. */}
            <DataTable
              caption="Organisations on this deployment"
              columns={columns}
              rows={rows}
              rowKey={(org) => org.id}
              sort={tableSort}
              onSortChange={onSortChange}
              emptyMessage="No organisation matches these filters."
              tableClassName="min-w-[72rem]"
            />

            {page && (
              <Pagination
                page={page.page}
                pageCount={page.pageCount}
                total={page.total}
                from={page.from}
                to={page.to}
                onPageChange={filterApi.setPage}
                noun="organisations"
              />
            )}
          </Card>
        </div>
      )}

      <AdminCreateOrgModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={handleOrgCreated}
      />
    </AdminPage>
  );
}
