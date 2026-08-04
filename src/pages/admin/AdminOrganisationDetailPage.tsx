import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, PlayCircle } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { PanelTabs } from '@/components/ui/PanelTabs';
import { StatTile } from '@/components/ui/StatTile';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import { SuspendOrgModal } from '@/components/admin/SuspendOrgModal';
import {
  getOrgSubscription,
  getOrgUsage,
  getOrganisation,
  listOrgAuditLogs,
  listOrgDepartments,
  listOrgLocations,
  listOrgMembers,
  setOrgStatus,
  type OrgMemberRow,
  type OrgUsage,
} from '@/services/platformOrgService';
import { usePermissions } from '@/hooks/usePermissions';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/hooks/useToast';
import { reportError } from '@/lib/sentry';
import type {
  AuditLog,
  Department,
  Location,
  Organisation,
  OrganisationStatus,
  Subscription,
} from '@/types';

type Tab = 'overview' | 'users' | 'locations' | 'subscription' | 'usage' | 'audit';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'users', label: 'Users' },
  { value: 'locations', label: 'Locations' },
  { value: 'subscription', label: 'Subscription' },
  { value: 'usage', label: 'Usage' },
  { value: 'audit', label: 'Audit' },
] as const satisfies readonly { value: Tab; label: string }[];

const STATUS_TONE = {
  active: 'success',
  suspended: 'warning',
  archived: 'neutral',
} as const;

interface Detail {
  organisation: Organisation;
  members: OrgMemberRow[];
  locations: Location[];
  departments: Department[];
  subscription: Subscription | null;
  usage: OrgUsage;
  audit: AuditLog[];
}

/**
 * `/admin/organisations/:organisationId` — one tenant, in depth.
 *
 * Tabs are `PanelTabs` (state) rather than `Tabs` (routes): the sections swap
 * content for one already-addressed organisation, and minting six routes per
 * tenant would be noise. The organisation itself has a URL; its Usage tab does
 * not need one.
 *
 * ## The one write here
 *
 * Suspend and reactivate, and both are careful about what they claim.
 * `organisations.status` is read by no RLS policy — see the header of 0017 — so
 * suspending a customer does not stop their staff signing in or clocking in.
 * The screen says exactly that, in the confirm dialog and beside the badge,
 * because a control that looks like a lockout and is not one is worse than no
 * control at all.
 */
export function AdminOrganisationDetailPage(): JSX.Element {
  const { organisationId = '' } = useParams();
  const { canManagePlatformConfig } = usePermissions();
  const { confirm } = useConfirm();
  const { showError, showSuccess } = useToast();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setNotFound(false);
    setDetail(null);
    void (async () => {
      try {
        const organisation = await getOrganisation(organisationId);
        if (!active) return;
        if (!organisation) {
          setNotFound(true);
          return;
        }
        const [members, locations, departments, subscription, usage, audit] =
          await Promise.all([
            listOrgMembers(organisationId),
            listOrgLocations(organisationId),
            listOrgDepartments(organisationId),
            getOrgSubscription(organisationId),
            getOrgUsage(organisationId),
            listOrgAuditLogs(organisationId),
          ]);
        if (!active) return;
        setDetail({
          organisation,
          members,
          locations,
          departments,
          subscription,
          usage,
          audit,
        });
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:organisation-detail' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [organisationId, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const applyStatus = useCallback(
    async (next: OrganisationStatus, reason?: string): Promise<void> => {
      setBusy(true);
      try {
        await setOrgStatus(organisationId, next, reason);
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                organisation: {
                  ...prev.organisation,
                  status: next,
                  suspended_at: next === 'active' ? null : new Date().toISOString(),
                  suspended_reason: next === 'active' ? null : (reason ?? null),
                },
              }
            : prev,
        );
        setSuspendOpen(false);
        showSuccess(
          next === 'active' ? 'Organisation reactivated.' : 'Organisation suspended.',
        );
      } catch (err) {
        reportError(err, { area: 'admin:set-org-status' });
        // The database's own refusal says what to do next; "please try again"
        // tells someone to repeat what cannot work.
        showError(
          err instanceof Error && err.message
            ? err.message
            : 'Could not change that. Please try again.',
        );
      } finally {
        setBusy(false);
      }
    },
    [organisationId, showError, showSuccess],
  );

  const reactivate = useCallback(async (): Promise<void> => {
    if (!detail) return;
    const ok = await confirm({
      title: `Reactivate ${detail.organisation.name}?`,
      message:
        'This clears the suspension and the recorded reason. The organisation returns to normal billing and support state.',
      confirmLabel: 'Reactivate',
    });
    if (!ok) return;
    await applyStatus('active');
  }, [detail, confirm, applyStatus]);

  const memberColumns = useMemo<DataTableColumn<OrgMemberRow>[]>(
    () => [
      {
        key: 'person',
        label: 'Person',
        width: 'w-[40%]',
        cell: (row) => (
          <Link
            to={`/admin/users/${row.userId}`}
            className="block min-w-0 hover:underline"
          >
            <p className="truncate font-medium text-content dark:text-content-dark">
              {row.fullName ?? '—'}
            </p>
            <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
              {row.email ?? 'No email recorded'}
            </p>
          </Link>
        ),
      },
      {
        key: 'role',
        label: 'Role',
        width: 'w-[20%]',
        cell: (row) => <span className="capitalize">{row.role}</span>,
      },
      {
        key: 'status',
        label: 'Status',
        width: 'w-[20%]',
        cell: (row) => (
          <Badge tone={row.status === 'active' ? 'success' : 'neutral'}>
            {row.status}
          </Badge>
        ),
      },
      {
        key: 'joined',
        label: 'Joined',
        width: 'w-[20%]',
        cell: (row) => (
          <span className="whitespace-nowrap text-content-muted dark:text-content-muted-dark">
            {new Date(row.joinedAt).toLocaleDateString('en-GB')}
          </span>
        ),
      },
    ],
    [],
  );

  if (notFound) {
    return (
      <AdminPage
        title="Organisation not found"
        description="No organisation on this deployment has that identifier."
      >
        <Card>
          <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
            It may have been deleted, or the link may be from another deployment.
          </p>
          <Link to="/admin/organisations">
            <Button variant="secondary">
              <ArrowLeft size={18} aria-hidden="true" />
              Back to organisations
            </Button>
          </Link>
        </Card>
      </AdminPage>
    );
  }

  if (failed) {
    return (
      <AdminPage title="Organisation" description="One tenant on this deployment.">
        <AdminError onRetry={retry} />
      </AdminPage>
    );
  }

  if (!detail) {
    return (
      <AdminPage title="Organisation" description="One tenant on this deployment.">
        <AdminLoading variant="tiles" rows={4} />
      </AdminPage>
    );
  }

  const { organisation: org } = detail;
  const status = (org.status as OrganisationStatus) ?? 'active';

  return (
    <AdminPage
      title={org.name}
      description={`${org.slug} · created ${new Date(org.created_at).toLocaleDateString('en-GB')}`}
      action={
        canManagePlatformConfig ? (
          status === 'active' ? (
            <Button
              variant="danger-outline"
              disabled={busy}
              onClick={() => setSuspendOpen(true)}
            >
              <Ban size={16} aria-hidden="true" />
              Suspend
            </Button>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => void reactivate()}>
              <PlayCircle size={16} aria-hidden="true" />
              Reactivate
            </Button>
          )
        ) : undefined
      }
    >
      <div className="space-y-5">
        <Link
          to="/admin/organisations"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          All organisations
        </Link>

        {status !== 'active' && (
          <Card className="border-warning/30 bg-warning/5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[status]}>{status}</Badge>
              <span className="text-sm font-medium text-content dark:text-content-dark">
                {org.suspended_at &&
                  `Since ${new Date(org.suspended_at).toLocaleDateString('en-GB')}`}
              </span>
            </div>
            {org.suspended_reason && (
              <p className="mt-2 text-sm text-content dark:text-content-dark">
                {org.suspended_reason}
              </p>
            )}
            {/* The honest caveat, on screen and not only in the migration. */}
            <p className="mt-2 text-sm text-content-muted dark:text-content-muted-dark">
              This is a billing and support state. It does not block access — staff at
              this organisation can still sign in, view rotas and clock in. Enforcing a
              lockout requires a change to row-level security that has not been made.
            </p>
          </Card>
        )}

        <PanelTabs
          items={TABS.map((t) => ({ value: t.value, label: t.label }))}
          active={tab}
          onChange={setTab}
          label="Organisation sections"
        />

        {tab === 'overview' && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Members"
              value={detail.members.filter((m) => m.status === 'active').length}
              hint={`${detail.members.length} total including invited`}
            />
            <StatTile
              label="Staff records"
              value={detail.usage.activeStaff}
              hint={`${detail.usage.staff} including inactive`}
            />
            <StatTile
              label="Locations"
              value={detail.usage.locations}
              hint={`${detail.usage.departments} departments`}
            />
            <StatTile
              label="Plan"
              value={detail.subscription?.plan ?? org.plan}
              hint={
                detail.subscription
                  ? `Subscription ${detail.subscription.status}`
                  : 'No subscription record'
              }
            />
          </div>
        )}

        {tab === 'users' && (
          <Card className="overflow-hidden p-0">
            <DataTable
              caption={`People with a membership in ${org.name}`}
              columns={memberColumns}
              rows={detail.members}
              rowKey={(row) => row.userId}
              emptyMessage="This organisation has no members."
            />
          </Card>
        )}

        {tab === 'locations' && (
          <div className="space-y-4">
            <Card className="p-0">
              <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
                {detail.locations.length === 0 ? (
                  <li className="px-5 py-4 text-sm text-content-muted dark:text-content-muted-dark">
                    No locations yet.
                  </li>
                ) : (
                  detail.locations.map((location) => (
                    <li key={location.id} className="px-5 py-3">
                      <p className="font-medium text-content dark:text-content-dark">
                        {location.name}
                      </p>
                      <p className="text-xs text-content-muted dark:text-content-muted-dark">
                        {
                          detail.departments.filter((d) => d.location_id === location.id)
                            .length
                        }{' '}
                        department(s)
                      </p>
                    </li>
                  ))
                )}
              </ul>
            </Card>
          </div>
        )}

        {tab === 'subscription' && (
          <Card>
            {detail.subscription ? (
              <dl className="grid gap-4 sm:grid-cols-2">
                <Field label="Plan" value={detail.subscription.plan} />
                <Field label="Status" value={detail.subscription.status} />
                <Field
                  label="Provider"
                  value={detail.subscription.provider ?? 'None recorded'}
                />
                <Field
                  label="Current period ends"
                  value={
                    detail.subscription.current_period_end
                      ? new Date(
                          detail.subscription.current_period_end,
                        ).toLocaleDateString('en-GB')
                      : 'Not set'
                  }
                />
              </dl>
            ) : (
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                This organisation has no subscription record. The plan shown elsewhere
                comes from <code>organisations.plan</code>, which is set at sign-up and is
                not a billing record.
              </p>
            )}
            <p className="mt-4 border-t border-surface-border pt-4 text-sm text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
              No payment provider is integrated, so there are no invoices, payments or
              amounts to show here — <code>subscriptions</code> records plan state only.
            </p>
          </Card>
        )}

        {tab === 'usage' && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatTile label="Staff records" value={detail.usage.staff} />
              <StatTile label="Locations" value={detail.usage.locations} />
              <StatTile label="Departments" value={detail.usage.departments} />
              <StatTile label="Published rotas" value={detail.usage.publishedRotas} />
              <StatTile
                label="Shifts this month"
                value={detail.usage.shiftsThisMonth}
                hint="From the 1st, UTC"
              />
              <StatTile
                label="Active memberships"
                value={detail.members.filter((m) => m.status === 'active').length}
              />
            </div>
            <Card className="border-warning/30 bg-warning/5">
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                These are counts, not quota. No plan in the schema carries a seat,
                location or shift limit, so there is nothing for usage to be measured
                against and no ceiling being enforced.
              </p>
            </Card>
          </div>
        )}

        {tab === 'audit' && (
          <Card className="p-0">
            <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
              {detail.audit.length === 0 ? (
                <li className="px-5 py-4 text-sm text-content-muted dark:text-content-muted-dark">
                  No events recorded for this organisation yet.
                </li>
              ) : (
                detail.audit.map((entry) => (
                  <li key={entry.id} className="px-5 py-3">
                    <p className="text-sm font-medium text-content dark:text-content-dark">
                      {entry.action}
                      {entry.entity_type ? ` · ${entry.entity_type}` : ''}
                    </p>
                    <p className="text-xs text-content-muted dark:text-content-muted-dark">
                      {entry.actor_name ?? entry.actor_email ?? 'System'} ·{' '}
                      {new Date(entry.created_at).toLocaleString('en-GB')}
                    </p>
                  </li>
                ))
              )}
            </ul>
          </Card>
        )}
      </div>

      <SuspendOrgModal
        open={suspendOpen}
        organisationName={org.name}
        busy={busy}
        onCancel={() => setSuspendOpen(false)}
        onConfirm={(reason) => void applyStatus('suspended', reason)}
      />
    </AdminPage>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-content-muted dark:text-content-muted-dark">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium capitalize text-content dark:text-content-dark">
        {value}
      </dd>
    </div>
  );
}
