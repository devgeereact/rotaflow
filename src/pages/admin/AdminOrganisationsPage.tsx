import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Download, Plus, Upload } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
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
import {
  countLocationsByOrg,
  countMembershipsByOrg,
  listAllOrganisations,
  listAllSubscriptions,
} from '@/services/platformService';
import type { CreatedOrganisationInvite } from '@/services/platformService';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { useToast } from '@/hooks/useToast';
import { humaniseKey, monthlyGrowth } from '@/lib/platformOverview';
import { healthBreakdown } from '@/lib/tenantHealth';
import { downloadCsv } from '@/lib/csv';
import { demoOrgFacts } from '@/lib/adminOverviewDemo';
import { reportError } from '@/lib/sentry';
import type { Organisation, OrganisationStatus, Subscription } from '@/types';

type OrgSortKey =
  | 'organisation'
  | 'industry'
  | 'members'
  | 'locations'
  | 'plan'
  | 'status'
  | 'usage'
  | 'activity'
  | 'actions';

const STATUS_TONE: Record<OrganisationStatus, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  suspended: 'warning',
  archived: 'neutral',
};

/** `/admin/organisations`. NEW_STRUCTURE §34's tenant management. */
export function AdminOrganisationsPage(): JSX.Element {
  const [organisations, setOrganisations] = useState<Organisation[] | null>(null);
  const [members, setMembers] = useState<Map<string, number>>(new Map());
  const [sites, setSites] = useState<Map<string, number>>(new Map());
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState('');
  const [sort, setSort] = useState<DataTableSort<OrgSortKey> | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<{
    orgName: string;
    email: string;
    url: string;
  } | null>(null);
  const { showSuccess, showError } = useToast();

  useEffect(() => {
    let active = true;
    setFailed(false);
    setOrganisations(null);
    void (async () => {
      try {
        const [orgs, counts, siteCounts, subs] = await Promise.all([
          listAllOrganisations(),
          countMembershipsByOrg(),
          countLocationsByOrg(),
          listAllSubscriptions(),
        ]);
        if (!active) return;
        setOrganisations(orgs);
        setMembers(counts);
        setSites(siteCounts);
        setSubscriptions(subs);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:organisations' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  const handleOrgCreated = useCallback(
    (result: CreatedOrganisationInvite, orgName: string, email: string) => {
      setCreateModalOpen(false);
      setCreatedInvite({ orgName, email, url: result.acceptUrl });
      setReloadKey((k) => k + 1);
      showSuccess(`${orgName} created. Copy the invite link and send it to ${email}.`);
    },
    [showSuccess],
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

  const subByOrg = useMemo(() => {
    const map = new Map<string, Subscription>();
    for (const sub of subscriptions) map.set(sub.org_id, sub);
    return map;
  }, [subscriptions]);

  // Placeholder industry / usage / last-activity, keyed so a row keeps the same
  // invented values as it is sorted and filtered. See `adminOverviewDemo`.
  const facts = useCallback(
    (org: Organisation) =>
      demoOrgFacts(
        org.id,
        (organisations ?? []).findIndex((o) => o.id === org.id),
      ),
    [organisations],
  );

  const planOf = useCallback(
    (org: Organisation): string => subByOrg.get(org.id)?.plan ?? org.plan,
    [subByOrg],
  );

  const summary = useMemo(() => {
    if (!organisations) return null;
    const byStatus = (s: OrganisationStatus): number =>
      organisations.filter((o) => o.status === s).length;
    const growth = monthlyGrowth(organisations, new Date(), 2);
    const thisMonth = growth[growth.length - 1]?.created ?? 0;
    const lastMonth = growth[growth.length - 2]?.created ?? 0;
    return {
      total: organisations.length,
      active: byStatus('active'),
      suspended: byStatus('suspended'),
      archived: byStatus('archived'),
      newThisMonth: thisMonth,
      // Real, not `DEMO_ORGS_NEW_CHANGE`: both months come from the same
      // `created_at` column the growth chart on `/admin` reads, so this and
      // that screen cannot disagree. Nothing to compare against when last
      // month had zero organisations, so the hint says so rather than /0.
      newThisMonthChange:
        lastMonth === 0
          ? thisMonth > 0
            ? 'No organisations last month'
            : null
          : `${thisMonth >= lastMonth ? '+' : ''}${(((thisMonth - lastMonth) / lastMonth) * 100).toFixed(0)}% vs last month`,
      plans: [...new Set(organisations.map((o) => planOf(o)))].sort(),
      // From `subscriptions.status` and `organisations.last_activity_at`, the
      // same two columns the Overview's health bands read, so the two screens
      // agree about which tenants are in trouble.
      trialing: subscriptions.filter((sub) => sub.status === 'trialing').length,
      atRisk:
        healthBreakdown(organisations, subscriptions, new Date()).find(
          (band) => band.band === 'at_risk',
        )?.count ?? 0,
    };
  }, [organisations, planOf, subscriptions]);

  const visible = useMemo(() => {
    if (!organisations) return [];
    const q = search.trim().toLowerCase();
    const filtered = organisations.filter((o) => {
      if (status && o.status !== status) return false;
      if (plan && planOf(o) !== plan) return false;
      if (!q) return true;
      return o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q);
    });

    // `null` sort keeps the service's own order. Newest tenant first, which
    // is the more useful default on this screen than any column.
    if (!sort) return filtered;

    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case 'members':
          return ((members.get(a.id) ?? 0) - (members.get(b.id) ?? 0)) * direction;
        case 'locations':
          return ((sites.get(a.id) ?? 0) - (sites.get(b.id) ?? 0)) * direction;
        case 'plan':
          return planOf(a).localeCompare(planOf(b)) * direction;
        case 'status':
          return a.status.localeCompare(b.status) * direction;
        case 'industry':
          return facts(a).industry.localeCompare(facts(b).industry) * direction;
        case 'usage':
          return (facts(a).usage - facts(b).usage) * direction;
        case 'activity':
          // The real column, not created_at: `activity` sorts the same field
          // the "Last activity" cell now shows and the "At risk" tile above
          // already reads (tenantHealth.ts) — three places that used to be
          // free to disagree about which organisations look neglected.
          return (
            ((a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0) -
              (b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0)) *
            direction
          );
        default:
          return a.name.localeCompare(b.name) * direction;
      }
    });
  }, [organisations, search, status, plan, sort, members, sites, planOf, facts]);

  const columns = useMemo<DataTableColumn<Organisation, OrgSortKey>[]>(
    () => [
      {
        key: 'organisation',
        label: 'Organisation',
        width: 'w-[20%]',
        sortable: true,
        cell: (org) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-primary/20 bg-primary-wash text-[0.65rem] font-semibold text-primary dark:bg-primary-wash-dark">
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
            </span>
          </span>
        ),
      },
      {
        key: 'industry',
        label: 'Industry',
        width: 'w-[11%]',
        sortable: true,
        cell: (org) => facts(org).industry,
      },
      {
        key: 'plan',
        label: 'Plan',
        width: 'w-[9%]',
        sortable: true,
        cell: (org) => <Badge tone="neutral">{humaniseKey(planOf(org))}</Badge>,
      },
      {
        key: 'members',
        label: 'Users',
        width: 'w-[6%]',
        numeric: true,
        sortable: true,
        cell: (org) => members.get(org.id) ?? 0,
      },
      {
        key: 'locations',
        label: 'Sites',
        width: 'w-[5%]',
        numeric: true,
        sortable: true,
        cell: (org) => sites.get(org.id) ?? 0,
      },
      {
        key: 'status',
        label: 'Status',
        width: 'w-[10%]',
        sortable: true,
        cell: (org) => (
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={STATUS_TONE[org.status as OrganisationStatus] ?? 'neutral'} dot>
              {humaniseKey(org.status)}
            </Badge>
          </span>
        ),
      },
      {
        key: 'usage',
        label: 'Usage',
        width: 'w-[10%]',
        sortable: true,
        cell: (org) => {
          const { usage } = facts(org);
          return (
            <span className="flex items-center justify-end gap-2">
              <span className="font-mono text-xs tabular-nums">{usage}%</span>
              <span className="block h-1.5 w-11 overflow-hidden rounded-full border border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
                <span
                  className={`block h-full ${usage > 90 ? 'bg-warning' : 'bg-primary'}`}
                  style={{ width: `${usage}%` }}
                />
              </span>
            </span>
          );
        },
      },
      {
        key: 'activity',
        label: 'Last activity',
        width: 'w-[11%]',
        sortable: true,
        // The real organisations.last_activity_at, not the demo fixture's
        // fabricated string — a tenant the "At risk" tile above counts as
        // never-active (this same column, tenantHealth.ts) used to show
        // "today" one column across, and the two could never agree.
        cell: (org) => (
          <span className="whitespace-nowrap text-content-muted dark:text-content-muted-dark">
            {org.last_activity_at
              ? new Date(org.last_activity_at).toLocaleDateString('en-GB')
              : 'Never'}
          </span>
        ),
      },
      {
        key: 'actions',
        label: 'Actions',
        width: 'w-[18%]',
        align: 'right',
        cell: (org) => (
          <span className="flex justify-end gap-1.5">
            <Link
              to={`/admin/organisations/${org.id}`}
              className="rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-content hover:bg-surface-subtle dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
            >
              View
            </Link>
            <Link
              to="/admin/support-access"
              className="rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-content hover:bg-surface-subtle dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
            >
              Access
            </Link>
            {/* Suspend and reactivate are confirmed writes with a reason, so
                they stay on the organisation's own page where the dialog and
                the consequences live. This is the way in. */}
            <Link
              to={`/admin/organisations/${org.id}`}
              className={`rounded-lg border px-2 py-1 text-xs font-medium ${
                org.status === 'suspended'
                  ? 'border-surface-border text-content hover:bg-surface-subtle dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark'
                  : 'border-danger/34 text-danger hover:bg-danger-wash dark:hover:bg-danger-wash-dark'
              }`}
            >
              {org.status === 'suspended' ? 'Reactivate' : 'Suspend'}
            </Link>
          </span>
        ),
      },
    ],
    [members, sites, planOf, facts],
  );

  // Exports what is on screen, not the whole table: the filters above are the
  // question being asked, and an export that quietly ignores them is the wrong
  // answer to it.
  // Industry and Usage % are deliberately NOT here — both come from
  // demoOrgFacts, a fixture keyed by row position, not real data (see
  // `facts` above). AdminSubscriptionsPage's export already omits its own
  // demo columns for the same reason; this file's own on-screen table
  // discloses them as placeholders, but a CSV leaves the product and lands
  // in someone's real reporting with no such disclosure attached.
  const exportCsv = useCallback(() => {
    downloadCsv(`organisations_${new Date().toISOString().slice(0, 10)}`, visible, [
      { label: 'Name', value: (org) => org.name },
      { label: 'Slug', value: (org) => org.slug },
      { label: 'Plan', value: (org) => planOf(org) },
      { label: 'Status', value: (org) => org.status },
      { label: 'Members', value: (org) => members.get(org.id) ?? 0 },
      { label: 'Sites', value: (org) => sites.get(org.id) ?? 0 },
      { label: 'Last activity', value: (org) => org.last_activity_at ?? 'Never' },
      { label: 'Created', value: (org) => org.created_at },
    ]);
  }, [visible, members, sites, planOf]);

  return (
    <AdminPage
      title="Organisations"
      description="Manage customer organisations, subscriptions, access and platform activity."
      action={
        <>
          <Button variant="secondary" disabled title="Bulk import is not built">
            <Upload size={15} aria-hidden="true" />
            Import
          </Button>
          <Button variant="secondary" onClick={exportCsv} disabled={visible.length === 0}>
            <Download size={15} aria-hidden="true" />
            Export
          </Button>
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus size={15} aria-hidden="true" />
            Add organisation
          </Button>
        </>
      }
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !organisations || !summary ? (
        <AdminLoading />
      ) : organisations.length === 0 ? (
        <AdminEmpty message="No organisations have been created on this deployment yet." />
      ) : (
        <div className="space-y-4">
          {createdInvite && (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
              <h2 className="mb-1 font-medium text-content dark:text-content-dark">
                Invitation link for {createdInvite.email}
              </h2>
              <p className="mb-3 text-sm text-content-muted dark:text-content-muted-dark">
                {createdInvite.orgName} is created. Send this link to{' '}
                {createdInvite.email} so they can accept and become its owner. It is shown
                once — RotaFlow stores only a hash of the token, so it cannot be retrieved
                again.
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

          <TileGrid>
            <StatTile label="Total" value={summary.total.toLocaleString('en-GB')} />
            <StatTile
              label="Active"
              value={summary.active.toLocaleString('en-GB')}
              hint={`${((summary.active / summary.total) * 100).toFixed(1)}%`}
            />
            <StatTile
              label="Trialing"
              value={summary.trialing}
              hint={
                summary.trialing === 0
                  ? 'No trial running'
                  : 'Subscription not yet active'
              }
            />
            <StatTile
              label="Suspended"
              value={summary.suspended}
              hint={
                summary.suspended ? (
                  <span className="font-semibold text-danger">payment or abuse</span>
                ) : (
                  'None'
                )
              }
            />
            <StatTile
              label="At risk"
              value={summary.atRisk}
              hint="No activity in 30 days, or never"
            />
            <StatTile
              label="New this month"
              value={summary.newThisMonth}
              hint={
                summary.newThisMonthChange ? (
                  <span className="font-semibold text-success">
                    {summary.newThisMonthChange}
                  </span>
                ) : (
                  'No prior month to compare'
                )
              }
            />
          </TileGrid>

          <Card className="p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-divider p-3 dark:border-divider-dark">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or slug…"
                aria-label="Search organisations"
                className="max-w-xs"
              />
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label="Filter by status"
                className="w-auto"
              >
                <option value="">Any status</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="archived">Archived</option>
              </Select>
              <Select
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                aria-label="Filter by plan"
                className="w-auto"
              >
                <option value="">All plans</option>
                {summary.plans.map((p) => (
                  <option key={p} value={p}>
                    {humaniseKey(p)}
                  </option>
                ))}
              </Select>
              <span className="ml-auto font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
                {visible.length} of {summary.total}
              </span>
            </div>

            {/* The table scrolls inside its own container so the page never
                does. The pattern §27 asks for on wide data. `DataTable` owns
                that, along with the sort affordance and the empty row. */}
            <DataTable
              caption="Organisations on this deployment"
              columns={columns}
              rows={visible}
              rowKey={(org) => org.id}
              sort={sort}
              onSortChange={setSort}
              emptyMessage="No organisation matches these filters."
            />
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
