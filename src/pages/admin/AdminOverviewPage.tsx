import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, CreditCard, Flag, KeyRound, Plug } from 'lucide-react';
import { Panel } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import { MeterRows } from '@/components/ui/MeterRows';
import { Sparkline, TrendChart } from '@/components/ui/TrendChart';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import {
  countMembershipsByOrg,
  countPublishedRotas,
  listAllOrganisations,
  listAllProfiles,
  listAllSubscriptions,
  listPlatformAuditLogs,
} from '@/services/platformService';
import { listSupportAccessSessions } from '@/services/supportAccessService';
import { sessionStatus, type SupportAccessSession } from '@/lib/supportAccess';
import { monthlyGrowth } from '@/lib/platformOverview';
import {
  demoChurnTrend,
  DEMO_ACTIVITY,
  DEMO_PUBLISHED_ROTAS_TREND,
  DEMO_SECTIONS,
  DEMO_SERVICES,
  DEMO_USERS_TREND,
  type DemoActivityTone,
  type DemoServiceState,
} from '@/lib/adminOverviewDemo';
import { listInvoices, listPlans, type Invoice } from '@/services/billingService';
import { listSupportCases, type SupportCaseRow } from '@/services/supportCaseService';
import { formatMoney } from '@/lib/money';
import { collectedByMonth, monthlyRecurringPence, revenueByPlan } from '@/lib/revenue';
import { openCases, urgentOpenCases } from '@/lib/supportMetrics';
import { healthBreakdown, tenantsActiveWithin } from '@/lib/tenantHealth';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { reportError } from '@/lib/sentry';
import type { AuditLog, Organisation, Profile, Subscription } from '@/types';

interface Snapshot {
  organisations: Organisation[];
  profiles: Profile[];
  subscriptions: Subscription[];
  recentAudit: AuditLog[];
  members: Map<string, number>;
  sessions: SupportAccessSession[];
  publishedRotas: number;
  plans: { code: string; monthly_price_pence: number }[];
  invoices: Invoice[];
  supportCases: SupportCaseRow[];
}

const ACTIVITY_ICON = {
  building: Building2,
  card: CreditCard,
  key: KeyRound,
  flag: Flag,
  plug: Plug,
} as const;

const ACTIVITY_TONE: Record<DemoActivityTone, string> = {
  success: 'bg-success-wash text-success dark:bg-success-wash-dark',
  info: 'bg-primary-wash text-primary dark:bg-primary-wash-dark',
  warning: 'bg-warning-wash text-warning dark:bg-warning-wash-dark',
  danger: 'bg-danger-wash text-danger dark:bg-danger-wash-dark',
};

const SEGMENT = {
  operational: 'bg-success',
  degraded: 'bg-warning',
  outage: 'bg-danger',
} as const;

/** The twelve-slot uptime strip beside each service. */
function StatusBars({ history }: { history: readonly DemoServiceState[] }): JSX.Element {
  return (
    <span className="ml-auto flex shrink-0 gap-[2px]" aria-hidden="true">
      {history.map((state, i) => (
        <span key={i} className={`block h-[18px] w-[4px] rounded-sm ${SEGMENT[state]}`} />
      ))}
    </span>
  );
}

const HEALTH_COLOUR: Record<string, string> = {
  healthy: '#1EA06B',
  attention: '#E0A030',
  at_risk: '#D94A3A',
  suspended: '#6B7280',
};

const CASE_TONE: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  urgent: 'danger',
  high: 'warning',
  normal: 'info',
  low: 'neutral',
};

/**
 * `/admin` — NEW_STRUCTURE §34's platform dashboard, built to the full shape of
 * `docs/PLATFORM_CONSOLE.html`.
 *
 * ## Which figures are real
 *
 * Organisation counts, the twelve-month growth series, memberships,
 * subscriptions, published rotas, open support-access sessions and the audit
 * feed all come from the database.
 *
 * ## Which are not
 *
 * Active users today, revenue, the named plan tiers, organisation health,
 * per-service uptime history and support cases are **placeholder values** from
 * `src/lib/adminOverviewDemo.ts`, at the owner's request, so the screen can be
 * finished to its intended shape before the schema can supply them. Every one
 * of them is a metric this deployment genuinely cannot compute — the reasons
 * are recorded in that file, alongside how to remove it. The notice at the foot
 * of this screen names them, so nobody reads a placeholder as a measurement.
 */
export function AdminOverviewPage(): JSX.Element {
  const [data, setData] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setData(null);
    void (async () => {
      try {
        const [
          organisations,
          profiles,
          subscriptions,
          recentAudit,
          members,
          sessions,
          publishedRotas,
          plans,
          invoices,
          supportCases,
        ] = await Promise.all([
          listAllOrganisations(),
          listAllProfiles(),
          listAllSubscriptions(),
          listPlatformAuditLogs(8),
          countMembershipsByOrg(),
          listSupportAccessSessions(20),
          countPublishedRotas(),
          listPlans(),
          listInvoices(),
          listSupportCases(),
        ]);
        if (!active) return;
        setData({
          organisations,
          profiles,
          subscriptions,
          recentAudit,
          members,
          sessions,
          publishedRotas,
          plans,
          invoices,
          supportCases,
        });
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:overview' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  const derived = useMemo(() => {
    if (!data) return null;
    const now = new Date();
    const growth = monthlyGrowth(data.organisations, now);
    const active = data.organisations.filter((o) => o.status === 'active').length;
    return {
      growth,
      active,
      activeShare: data.organisations.length
        ? `${((active / data.organisations.length) * 100).toFixed(1)}% of all tenants`
        : 'No tenants yet',
      newThisMonth: growth[growth.length - 1]?.created ?? 0,

      // Revenue and the support queue are real tables now (0023, 0024), so the
      // overview computes them from the same functions Billing and the Support
      // Centre use. Two screens quoting one number is only safe when they share
      // the arithmetic.
      mrr: monthlyRecurringPence(
        data.subscriptions,
        new Map(data.plans.map((p) => [p.code, p.monthly_price_pence])),
      ),
      revenueTrend: collectedByMonth(data.invoices, 12, now).map((t) =>
        Math.round(t.pence / 100),
      ),
      planMix: revenueByPlan(
        data.subscriptions,
        new Map(data.plans.map((p) => [p.code, p.monthly_price_pence])),
      ),
      openCases: openCases(data.supportCases),
      urgentCases: urgentOpenCases(data.supportCases),
      recentCases: data.supportCases.slice(0, 4),

      // `organisations.last_activity_at` is maintained by touch_org_activity()
      // (0023), so tenant activity is measurable. Per-*user* activity still is
      // not — nothing records a session — so the tile counts tenants and says
      // so rather than reporting a number of people nobody observed.
      activeTenants: tenantsActiveWithin(data.organisations, now),
      health: healthBreakdown(data.organisations, data.subscriptions, now),
      openSessions: data.sessions.filter((s) => sessionStatus(s, now) === 'active')
        .length,
    };
  }, [data]);

  return (
    <AdminPage
      title="Platform overview"
      description="Organisations, users, subscriptions and platform performance across every RotaFlow tenant."
      action={
        <>
          <Select aria-label="Reporting period" className="w-auto" defaultValue="12">
            <option value="12">Last 12 months</option>
            <option value="3">Last 90 days</option>
            <option value="1">Last 30 days</option>
          </Select>
          <Button variant="secondary">Export report</Button>
        </>
      }
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !data || !derived ? (
        <AdminLoading variant="tiles" />
      ) : (
        <div className="space-y-4">
          <TileGrid>
            <StatTile
              label="Total organisations"
              value={data.organisations.length.toLocaleString('en-GB')}
              hint={
                <>
                  <span className="font-semibold text-success">
                    +{derived.newThisMonth}
                  </span>{' '}
                  this month
                </>
              }
              to="/admin/organisations"
              chart={<Sparkline values={derived.growth.map((g) => g.total)} />}
            />
            <StatTile
              label="Active organisations"
              value={derived.active.toLocaleString('en-GB')}
              hint={derived.activeShare}
              to="/admin/organisations"
              chart={
                <Sparkline values={derived.growth.map((g) => g.total)} colour="#1EA06B" />
              }
            />
            <StatTile
              label="Total users"
              value={data.profiles.length.toLocaleString('en-GB')}
              hint={`${data.profiles.filter((p) => p.is_platform_admin).length} platform administrators`}
              to="/admin/users"
              chart={<Sparkline values={DEMO_USERS_TREND} />}
            />
            <StatTile
              label="Tenants active today"
              value={derived.activeTenants.toLocaleString('en-GB')}
              hint={
                data.organisations.length
                  ? `${((derived.activeTenants / data.organisations.length) * 100).toFixed(0)}% of all tenants`
                  : 'No tenants yet'
              }
              to="/admin/organisations"
            />
            <StatTile
              label="Published rotas"
              value={data.publishedRotas.toLocaleString('en-GB')}
              hint="Across every tenant"
              chart={<Sparkline values={DEMO_PUBLISHED_ROTAS_TREND} colour="#1EA06B" />}
            />
            <StatTile
              label="Monthly recurring revenue"
              value={formatMoney(derived.mrr)}
              hint="Active and past due"
              to="/admin/billing"
              chart={<Sparkline values={derived.revenueTrend} colour="#E0A030" />}
            />
          </TileGrid>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              className="lg:col-span-2"
              title="Platform growth"
              actions={<Badge tone="neutral">Last 12 months</Badge>}
            >
              <TrendChart
                title="Organisations created and total, by month"
                labels={derived.growth.map((g) => g.label)}
                series={[
                  {
                    name: 'Active organisations',
                    values: derived.growth.map((g) => g.total),
                    colour: '#3B6FE0',
                  },
                  {
                    name: 'New organisations',
                    values: derived.growth.map((g) => g.created),
                    colour: '#1EA06B',
                    lineOnly: true,
                  },
                  {
                    name: 'Churned',
                    values: demoChurnTrend(derived.growth.map((g) => g.total)),
                    colour: '#D94A3A',
                    lineOnly: true,
                  },
                ]}
                height={310}
              />
              <p className="mt-1 text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
                New organisations are counted in the month they signed up, and the current
                month is partial. Active and new are real; churn is a placeholder —
                nothing records the month an organisation left.
              </p>
            </Panel>

            <div className="grid content-start gap-4">
              <Panel title="Subscription mix">
                {derived.planMix.length === 0 ? (
                  <p className="text-sm text-content-muted dark:text-content-muted-dark">
                    No subscription is active or past due.
                  </p>
                ) : (
                  <MeterRows
                    caption="Subscriptions by plan"
                    rows={derived.planMix.map((r) => ({
                      label: `${r.plan.charAt(0).toUpperCase()}${r.plan.slice(1)}`,
                      value: r.count,
                      display: `${r.count} · ${formatMoney(r.pence)}`,
                    }))}
                  />
                )}
              </Panel>
              <Panel
                title="Organisation health"
                actions={
                  <Link
                    to="/admin/organisations"
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Review
                  </Link>
                }
              >
                <MeterRows
                  caption="Organisations by account health"
                  rows={derived.health.map((row) => ({
                    label: row.label,
                    value: row.count,
                    colour: HEALTH_COLOUR[row.band],
                  }))}
                />
                <p className="mt-3 text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
                  From account status, subscription state and last activity: suspended
                  first, then a failed payment, then silence — over a fortnight needs
                  attention, over a month is at risk.
                </p>
              </Panel>
            </div>
          </div>

          {/* Three equal columns that stretch to the tallest, as the reference
              lays them out — `h-full` on each panel rather than a fixed height,
              so the row grows with whichever card has most in it. */}
          <div className="grid items-stretch gap-4 lg:grid-cols-3">
            <Panel
              className="h-full"
              title="System health"
              actions={
                <Link
                  to="/admin/platform-health"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  All services
                </Link>
              }
              flush
            >
              <ul>
                {DEMO_SERVICES.map((service) => (
                  <li
                    key={service.name}
                    className="flex items-center gap-2.5 border-b border-divider px-4 py-2.5 last:border-0 dark:border-divider-dark"
                  >
                    <span className="text-sm font-semibold text-content dark:text-content-dark">
                      {service.name}
                    </span>
                    <Badge
                      tone={service.status === 'operational' ? 'success' : 'warning'}
                      dot
                    >
                      {service.status === 'operational' ? 'Operational' : 'Degraded'}
                    </Badge>
                    <StatusBars history={service.history} />
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel
              className="h-full"
              title="Platform activity"
              actions={
                <Link
                  to="/admin/audit"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Audit log
                </Link>
              }
              flush
            >
              <ul>
                {DEMO_ACTIVITY.map((item) => {
                  const Icon = ACTIVITY_ICON[item.icon];
                  return (
                    <li
                      key={item.title}
                      className="flex gap-3 border-b border-divider px-4 py-2.5 last:border-0 dark:border-divider-dark"
                    >
                      <span
                        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${ACTIVITY_TONE[item.tone]}`}
                      >
                        <Icon size={14} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm leading-snug text-content dark:text-content-dark">
                          {item.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-content-muted dark:text-content-muted-dark">
                          {item.meta}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <Panel
              className="h-full"
              title="Support"
              actions={
                <Link
                  to="/admin/support"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Support centre
                </Link>
              }
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-surface-border p-3.5 dark:border-surface-border-dark">
                  <p className="text-xs font-medium text-content-muted dark:text-content-muted-dark">
                    Open cases
                  </p>
                  <p className="mt-1 font-display text-[1.7rem] font-semibold leading-tight tabular-nums text-content dark:text-content-dark">
                    {derived.openCases}
                  </p>
                </div>
                <div className="rounded-2xl border border-surface-border p-3.5 dark:border-surface-border-dark">
                  <p className="text-xs font-medium text-content-muted dark:text-content-muted-dark">
                    Urgent
                  </p>
                  <p className="mt-1 font-display text-[1.7rem] font-semibold leading-tight tabular-nums text-content dark:text-content-dark">
                    {derived.urgentCases}
                  </p>
                </div>
              </div>

              {derived.recentCases.length === 0 ? (
                <p className="mt-3 text-sm text-content-muted dark:text-content-muted-dark">
                  No support case has been raised.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {derived.recentCases.map((item) => (
                    <li key={item.id} className="flex gap-2.5">
                      <Badge
                        tone={CASE_TONE[item.priority] ?? 'neutral'}
                        dot
                        className="mt-0.5 shrink-0"
                      >
                        {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}
                      </Badge>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold leading-snug text-content dark:text-content-dark">
                          {item.subject}
                        </span>
                        <span className="mt-0.5 block text-xs text-content-muted dark:text-content-muted-dark">
                          {item.orgName ?? 'Not identified'} ·{' '}
                          {new Date(item.created_at).toLocaleDateString('en-GB')}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {/* Placeholder data must never be mistaken for a measurement. Named
              here rather than badged on each card, which would break the
              layout this screen was rebuilt to match. */}
          <p className="text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
            <span className="font-semibold text-content dark:text-content-dark">
              Placeholder figures:
            </span>{' '}
            {DEMO_SECTIONS.join(', ')}. These are demonstration values, not measurements —
            see <code>src/lib/adminOverviewDemo.ts</code> for why each cannot yet be
            computed. Everything else is real: organisation counts and growth, users,
            published rotas, recurring revenue and the subscription mix from{' '}
            <code>subscriptions × plans</code>, the support queue, support access and the
            audit feed.
          </p>
        </div>
      )}
    </AdminPage>
  );
}
