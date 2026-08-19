import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Ban, Copy, PlayCircle } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, Panel } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { PanelTabs } from '@/components/ui/PanelTabs';
import { Callout } from '@/components/ui/Callout';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import {
  DEMO_ORG_MRR,
  DEMO_ORG_PROFILE,
  DEMO_ORG_STORAGE,
} from '@/lib/adminOverviewDemo';
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
import { listSupportAccessSessions } from '@/services/supportAccessService';
import { getOrgSmtpSettings } from '@/services/smtpSettingsService';
import { listGdprRequests } from '@/services/gdprRequestService';
import { createInvite } from '@/services/inviteService';
import { isValidEmail } from '@/lib/email';
import {
  formatRemaining,
  millisecondsRemaining,
  sessionStatus,
  SCOPE_LABELS,
  type SupportAccessSession,
} from '@/lib/supportAccess';
import type { GdprRequest } from '@/lib/gdprRequests';
import { usePermissions } from '@/hooks/usePermissions';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/hooks/useToast';
import { reportError } from '@/lib/sentry';
import type {
  AuditLog,
  Department,
  Location,
  Organisation,
  OrganisationStatus,
  OrgSmtpSettingsSafe,
  Subscription,
} from '@/types';

type Tab =
  | 'overview'
  | 'users'
  | 'locations'
  | 'subscription'
  | 'usage'
  | 'support'
  | 'integrations'
  | 'audit'
  | 'data';

/**
 * The console reference lists ten tabs. Nine are here; the tenth, Activity, is
 * not, a tenant activity timeline would have to come from `audit_logs`, which
 * still has essentially one writer, so it would show a couple of rows and imply
 * nothing else had happened. Stated on the Data tab rather than shown empty.
 */
const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'users', label: 'Users' },
  { value: 'locations', label: 'Locations' },
  { value: 'subscription', label: 'Subscription' },
  { value: 'usage', label: 'Usage' },
  { value: 'support', label: 'Support' },
  { value: 'integrations', label: 'Integrations' },
  { value: 'audit', label: 'Audit' },
  { value: 'data', label: 'Data' },
] as const satisfies readonly { value: Tab; label: string }[];

/** The tabs that read tenant rows rather than the customer register. */
// Only `locations` (and its `departments` sub-view) actually routes through
// `is_org_member()`/`has_org_role()`, the two functions 0028 gated on a
// session. `users` reads `memberships`, reopened to any platform admin by
// 0031; `usage` reads `platform_tenant_counts()`, a SECURITY DEFINER function
// that counts past RLS; `data` reads `gdpr_requests`, gated on platform role
// alone (0020). Listing them here would train an operator to open a session
// for a tab that was never going to ask for one.
const TENANT_TABS = new Set(['locations']);

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
  sessions: SupportAccessSession[];
  smtp: OrgSmtpSettingsSafe | null;
  gdpr: GdprRequest[];
}

/**
 * `/admin/organisations/:organisationId`, one tenant, in depth.
 *
 * Tabs are `PanelTabs` (state) rather than `Tabs` (routes): the sections swap
 * content for one already-addressed organisation, and minting six routes per
 * tenant would be noise. The organisation itself has a URL; its Usage tab does
 * not need one.
 *
 * ## The one write here
 *
 * Suspend and reactivate, and both are careful about what they claim.
 * `organisations.status` is read by no RLS policy. See the header of 0017, so
 * suspending a customer does not stop their staff signing in or clocking in.
 * The screen says exactly that, in the confirm dialog and beside the badge,
 * because a control that looks like a lockout and is not one is worse than no
 * control at all.
 */
/** One `dt`/`dd` pair in the detail panels. */
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <>
      <dt className="text-content-muted dark:text-content-muted-dark">{label}</dt>
      <dd className="font-medium text-content dark:text-content-dark">{children}</dd>
    </>
  );
}

export function AdminOrganisationDetailPage(): JSX.Element {
  const { organisationId = '' } = useParams();
  const { canManagePlatformConfig } = usePermissions();
  const { confirm } = useConfirm();
  const { showError, showSuccess } = useToast();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // In the URL rather than in component state, so a link can point at a
  // particular tab, "see the audit tab on this tenant" is a message people
  // send, and it was unlinkable before.
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab');
  const tab: Tab = TABS.some((t) => t.value === requestedTab)
    ? (requestedTab as Tab)
    : 'overview';
  const setTab = useCallback(
    (next: Tab) => {
      setParams((prev) => {
        const copy = new URLSearchParams(prev);
        copy.set('tab', next);
        return copy;
      });
    },
    [setParams],
  );
  const [busy, setBusy] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  // Re-invite affordance for an org stranded with zero members (the invite
  // that would have made it an owner expired, or was never accepted). Kept
  // as local state on this page rather than a new component — a single
  // email input and button doesn't earn its own file.
  const [reinviteEmail, setReinviteEmail] = useState('');
  const [reinviting, setReinviting] = useState(false);
  const [reinviteError, setReinviteError] = useState<string | null>(null);
  const [reinviteResult, setReinviteResult] = useState<string | null>(null);

  useEffect(() => {
    setReinviteEmail('');
    setReinviteError(null);
    setReinviteResult(null);
  }, [organisationId]);

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
        const [
          members,
          locations,
          departments,
          subscription,
          usage,
          audit,
          sessions,
          smtp,
          gdpr,
        ] = await Promise.all([
          listOrgMembers(organisationId),
          listOrgLocations(organisationId),
          listOrgDepartments(organisationId),
          getOrgSubscription(organisationId),
          getOrgUsage(organisationId),
          listOrgAuditLogs(organisationId),
          // Filtered client-side: the sessions table is small, the console
          // already reads it whole on the overview, and a per-org endpoint
          // would be a third query shape over the same forty rows.
          listSupportAccessSessions(200).then((all) =>
            all.filter((s) => s.orgId === organisationId),
          ),
          getOrgSmtpSettings(organisationId),
          listGdprRequests(200).then((all) =>
            all.filter((r) => r.orgId === organisationId),
          ),
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
          sessions,
          smtp,
          gdpr,
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
  useRegisterConsoleRefresh(retry);

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

  const handleReinvite = useCallback(async (): Promise<void> => {
    const trimmed = reinviteEmail.trim();
    if (!isValidEmail(trimmed)) {
      setReinviteError('That does not look like a valid email address.');
      return;
    }
    setReinviting(true);
    setReinviteError(null);
    try {
      const invite = await createInvite(organisationId, trimmed, 'owner');
      setReinviteResult(invite.acceptUrl);
      showSuccess(`Owner invite sent to ${trimmed}. Copy the link and share it.`);
    } catch (err) {
      reportError(err, { area: 'admin:organisation-detail:reinvite-owner' });
      setReinviteError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not create that invitation. Please try again.',
      );
    } finally {
      setReinviting(false);
    }
  }, [organisationId, reinviteEmail, showSuccess]);

  const copyReinviteLink = useCallback(async (): Promise<void> => {
    if (!reinviteResult) return;
    try {
      await navigator.clipboard.writeText(reinviteResult);
      showSuccess('Invitation link copied.');
    } catch (err) {
      reportError(err, { area: 'admin:organisation-detail:copy-reinvite-link' });
      showError('Could not copy. Select the link and copy it manually.');
    }
  }, [reinviteResult, showError, showSuccess]);

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
              {row.fullName ?? '-'}
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
  // The tenant's own owner, not a platform administrator. This is who a
  // support conversation actually starts with.
  const owner = detail.members.find((m) => m.role === 'owner') ?? null;

  // Counts come from a definer function and are always available; the tenant
  // rows behind the tabs do not. When the count says there are staff and the
  // rows came back empty, the gate is what is closed rather than the tenant
  // being empty.
  const gateClosed = detail.usage.locations > 0 && detail.locations.length === 0;

  return (
    <AdminPage
      title={org.name}
      avatar={
        <StaffAvatar
          firstName={org.name.split(' ')[0] ?? org.name}
          lastName={org.name.split(' ')[1] ?? ''}
          size="xl"
        />
      }
      meta={
        <>
          <span className="font-mono text-xs">{org.slug}</span>
          <span aria-hidden="true">·</span>
          <Badge tone="neutral">{detail.subscription?.plan ?? org.plan}</Badge>
          <Badge tone={STATUS_TONE[status]} dot>
            {status}
          </Badge>
          <span aria-hidden="true">·</span>
          <span>Created {new Date(org.created_at).toLocaleDateString('en-GB')}</span>
        </>
      }
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
              This is a billing and support state. It does not block access. Staff at this
              organisation can still sign in, view rotas and clock in. Enforcing a lockout
              requires a change to row-level security that has not been made.
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
          <div className="space-y-4">
            <TileGrid>
              <StatTile
                label="Users"
                value={detail.members.filter((m) => m.status === 'active').length}
                hint={`${detail.members.length} total including invited`}
              />
              <StatTile
                label="Locations"
                value={detail.usage.locations}
                hint={`${detail.usage.departments} departments`}
              />
              <StatTile
                label="Published rotas"
                value={detail.usage.publishedRotas}
                hint="Lifetime"
              />
              <StatTile
                label="Monthly shifts"
                value={detail.usage.shiftsThisMonth.toLocaleString('en-GB')}
                hint="This calendar month"
              />
              <StatTile
                label="Storage"
                value={DEMO_ORG_STORAGE}
                hint={<span className="text-warning">Placeholder</span>}
              />
              <StatTile
                label="MRR"
                value={DEMO_ORG_MRR}
                hint={<span className="text-warning">Placeholder</span>}
              />
            </TileGrid>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Organisation" bodyClassName="p-4">
                <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-3 text-sm">
                  <Row label="Slug">
                    <span className="font-mono text-xs">{org.slug}</span>
                  </Row>
                  <Row label="Plan">
                    <Badge tone="neutral">{detail.subscription?.plan ?? org.plan}</Badge>
                  </Row>
                  <Row label="Status">
                    <Badge tone={STATUS_TONE[status]} dot>
                      {status}
                    </Badge>
                  </Row>
                  <Row label="Size">
                    {detail.usage.activeStaff} staff · {detail.usage.locations} sites
                  </Row>
                  <Row label="Created">
                    {new Date(org.created_at).toLocaleDateString('en-GB')}
                  </Row>
                  {/* Everything below is placeholder, `organisations` records
                      none of it. Chipped rather than footnoted, so a reader
                      scanning the column cannot mistake one for the other. */}
                  {DEMO_ORG_PROFILE.map((row) => (
                    <Row key={row.label} label={row.label}>
                      <span className="flex flex-wrap items-center gap-2">
                        {row.value}
                        <Badge tone="warning">Placeholder</Badge>
                      </span>
                    </Row>
                  ))}
                </dl>
              </Panel>

              <Panel title="Primary contact" bodyClassName="p-4">
                {owner ? (
                  <>
                    <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-3 text-sm">
                      <Row label="Name">{owner.fullName ?? 'Not recorded'}</Row>
                      <Row label="Email">
                        <span className="font-mono text-xs">
                          {owner.email ?? 'Not recorded'}
                        </span>
                      </Row>
                      <Row label="Organisation role">
                        <Badge tone="neutral">{owner.role}</Badge>
                      </Row>
                      <Row label="Joined">
                        {new Date(owner.joinedAt).toLocaleDateString('en-GB')}
                      </Row>
                    </dl>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => setTab('users')}
                        title="Open the Users tab, filtered to this organisation"
                      >
                        View in users
                      </Button>
                      {owner.email && (
                        <a
                          href={`mailto:${owner.email}`}
                          className="inline-flex items-center rounded-lg border border-surface-border px-3 py-1.5 text-sm font-medium text-content hover:bg-surface-subtle dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                        >
                          Contact owner
                        </a>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-content-muted dark:text-content-muted-dark">
                      No member of this organisation holds the owner role, so there is
                      nobody to name as the primary contact. This usually means the
                      original owner invite expired, or was never accepted. Send a new one
                      below.
                    </p>
                    {reinviteResult ? (
                      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
                        <p className="mb-3 text-sm text-content-muted dark:text-content-muted-dark">
                          Invitation link created. Send it to the new owner &mdash; it is
                          shown once and cannot be retrieved again.
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-surface-border bg-background px-3 py-2 font-mono text-xs text-content dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark">
                            {reinviteResult}
                          </code>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void copyReinviteLink()}
                          >
                            <Copy size={14} aria-hidden="true" className="mr-1.5" />
                            Copy
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setReinviteResult(null);
                              setReinviteEmail('');
                            }}
                          >
                            Done
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <Label htmlFor="reinvite-owner-email">Owner&rsquo;s email</Label>
                        <div className="mt-1 flex flex-wrap items-start gap-2">
                          <Input
                            id="reinvite-owner-email"
                            type="email"
                            value={reinviteEmail}
                            onChange={(e) => setReinviteEmail(e.target.value)}
                            placeholder="owner@theircompany.com"
                            className="min-w-0 flex-1"
                          />
                          <Button
                            onClick={() => void handleReinvite()}
                            disabled={reinviting}
                          >
                            {reinviting ? 'Sending…' : 'Send owner invite'}
                          </Button>
                        </div>
                        {reinviteError && (
                          <p className="mt-2 text-sm text-danger" role="alert">
                            {reinviteError}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </Panel>
            </div>
          </div>
        )}

        {gateClosed && TENANT_TABS.has(tab) && (
          <Callout tone="info" title="This tab needs an active support session">
            <p>
              Since migration 0028 a platform administrator reads a tenant&rsquo;s staff
              records, rotas, shifts, attendance and leave only through a support access
              session for that organisation: one with a reason, a case reference and an
              expiry. Without one this tab is empty because the database refuses the rows,
              not because the organisation has none.
            </p>
            <p>
              The counts above still work. They come from a function that returns numbers
              rather than rows, so the size of a tenant is readable without reading who is
              in it. Request access from{' '}
              <Link to="/admin/support-access" className="text-primary hover:underline">
                Support Access
              </Link>
              .
            </p>
          </Callout>
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
              amounts to show here, <code>subscriptions</code> records plan state only.
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

        {tab === 'support' && (
          <div className="space-y-4">
            <Panel
              title="Temporary support access"
              actions={
                <Link
                  to="/admin/support-access"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Request access
                </Link>
              }
              flush
            >
              {detail.sessions.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
                  No support session has ever been opened against this organisation.
                </p>
              ) : (
                <ul>
                  {detail.sessions.map((session) => {
                    const state = sessionStatus(session, new Date());
                    return (
                      <li
                        key={session.id}
                        className="border-b border-divider px-4 py-3 last:border-0 dark:border-divider-dark"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            tone={
                              state === 'active'
                                ? 'warning'
                                : state === 'revoked'
                                  ? 'danger'
                                  : 'neutral'
                            }
                            dot
                          >
                            {state}
                          </Badge>
                          <span className="text-sm font-medium text-content dark:text-content-dark">
                            {session.adminName ?? 'Platform administrator'}
                          </span>
                          <span className="text-xs text-content-muted dark:text-content-muted-dark">
                            {SCOPE_LABELS[session.scope]} · case {session.caseRef}
                          </span>
                          <span className="ml-auto font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
                            {state === 'active'
                              ? formatRemaining(
                                  millisecondsRemaining(session.expiresAt, new Date()),
                                )
                              : new Date(session.grantedAt).toLocaleString('en-GB')}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
                          {session.reason}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel title="This organisation's own setting">
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                Support access is{' '}
                <span className="font-semibold text-content dark:text-content-dark">
                  {org.support_access_allowed ? 'permitted' : 'refused'}
                </span>{' '}
                by this organisation. A tenant can withdraw consent, and the request form
                honours it. The toggle belongs to the customer, not to the console.
              </p>
            </Panel>
          </div>
        )}

        {tab === 'integrations' && (
          <div className="space-y-4">
            <Panel title="Outgoing email (SMTP)">
              {detail.smtp ? (
                <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  {/* Every column here is nullable: `org_smtp_settings_safe`
                      is a view, and a view carries no NOT NULL for the
                      generator to read. */}
                  <Field label="Host" value={detail.smtp.smtp_host ?? '-'} />
                  <Field
                    label="Port"
                    value={
                      detail.smtp.smtp_port === null ? '-' : String(detail.smtp.smtp_port)
                    }
                  />
                  <Field label="Username" value={detail.smtp.smtp_user ?? '-'} />
                  <Field label="From address" value={detail.smtp.from_email ?? '-'} />
                  <Field label="From name" value={detail.smtp.from_name ?? '-'} />
                  <Field
                    label="Configured"
                    value={
                      detail.smtp.updated_at
                        ? new Date(detail.smtp.updated_at).toLocaleDateString('en-GB')
                        : 'Never'
                    }
                  />
                </dl>
              ) : (
                <p className="text-sm text-content-muted dark:text-content-muted-dark">
                  This organisation has not configured its own SMTP. Its mail goes out on
                  the platform sender.
                </p>
              )}
              {/* The password is not merely hidden here. The view this reads,
                  `org_smtp_settings_safe`, omits the column, so the console
                  cannot show it even by accident. */}
              <p className="mt-3 text-xs text-content-muted dark:text-content-muted-dark">
                The SMTP password is omitted at the column level by
                <span className="font-mono"> org_smtp_settings_safe</span>. It is not
                readable from the console.
              </p>
            </Panel>

            <Panel title="Other integrations">
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                SMTP is the only per-organisation integration this deployment has.
                Payroll, HR, calendar and identity connectors are not built. There are no
                tables holding a connection, a sync state or a failure count, so there is
                nothing here to report on rather than a list of connectors showing a green
                tick for something that does not run.
              </p>
            </Panel>
          </div>
        )}

        {tab === 'audit' && (
          <Panel title="Organisation audit trail" flush>
            <ul>
              {detail.audit.length === 0 ? (
                <li className="px-4 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
                  No events recorded for this organisation yet.
                </li>
              ) : (
                detail.audit.map((entry) => (
                  <li
                    key={entry.id}
                    className="border-b border-divider px-4 py-2.5 last:border-0 dark:border-divider-dark"
                  >
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
          </Panel>
        )}

        {tab === 'data' && (
          <div className="space-y-4">
            <Panel
              title="Data rights requests"
              actions={
                <Link
                  to="/admin/gdpr"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  All requests
                </Link>
              }
              flush
            >
              {detail.gdpr.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
                  No export, deletion or correction request has been raised for this
                  organisation.
                </p>
              ) : (
                <ul>
                  {detail.gdpr.map((request) => (
                    <li
                      key={request.id}
                      className="flex flex-wrap items-center gap-2 border-b border-divider px-4 py-2.5 last:border-0 dark:border-divider-dark"
                    >
                      <Badge tone="neutral">{request.kind}</Badge>
                      <span className="text-sm text-content dark:text-content-dark">
                        {request.subjectName ?? request.subjectEmail}
                      </span>
                      <Badge tone={request.closedAt ? 'success' : 'warning'} dot>
                        {request.status}
                      </Badge>
                      <span className="ml-auto font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
                        due {new Date(request.dueOn).toLocaleDateString('en-GB')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {/* What this tab in the reference offers that this deployment does
                not, said plainly rather than shown as a disabled button. */}
            <Panel title="Not available here">
              <ul className="space-y-3 text-sm text-content-muted dark:text-content-muted-dark">
                <li>
                  <span className="font-semibold text-content dark:text-content-dark">
                    Whole-organisation export.
                  </span>{' '}
                  Export is per data subject, through the GDPR screen. There is no
                  tenant-wide bundle, because nothing assembles one.
                </li>
                <li>
                  <span className="font-semibold text-content dark:text-content-dark">
                    Deletion with a grace period.
                  </span>{' '}
                  Erasure anonymises one staff record. Deleting a tenant is a database
                  operation, deliberately not a console button.
                </li>
                <li>
                  <span className="font-semibold text-content dark:text-content-dark">
                    Storage usage.
                  </span>{' '}
                  Documents are recorded as rows but no file storage is wired up, so there
                  are no bytes to total.
                </li>
                <li>
                  <span className="font-semibold text-content dark:text-content-dark">
                    Activity timeline.
                  </span>{' '}
                  Rota, attendance and leave writes are not audited yet, so a timeline
                  would show a handful of events and imply nothing else happened.
                </li>
              </ul>
            </Panel>
          </div>
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
