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
  DEMO_ACTIVE_USERS_SHARE,
  DEMO_ACTIVE_USERS_TODAY,
  DEMO_ACTIVE_USERS_TREND,
  DEMO_ACTIVITY,
  DEMO_CASES,
  DEMO_MONTHLY_REVENUE,
  DEMO_OPEN_CASES,
  DEMO_ORG_HEALTH,
  DEMO_PUBLISHED_ROTAS_TREND,
  DEMO_REVENUE_CHANGE,
  DEMO_REVENUE_TREND,
  DEMO_SECTIONS,
  DEMO_SERVICES,
  DEMO_SUBSCRIPTION_MIX,
  DEMO_URGENT_CASES,
  DEMO_USERS_TREND,
  type DemoActivityTone,
  type DemoServiceState,
} from '@/lib/adminOverviewDemo';
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

const CASE_TONE = {
  Urgent: 'danger',
  High: 'warning',
  Normal: 'info',
} as const;

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
        ] = await Promise.all([
          listAllOrganisations(),
          listAllProfiles(),
          listAllSubscriptions(),
          listPlatformAuditLogs(8),
          countMembershipsByOrg(),
          listSupportAccessSessions(20),
          countPublishedRotas(),
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
              label="Active users today"
              value={DEMO_ACTIVE_USERS_TODAY.toLocaleString('en-GB')}
              hint={DEMO_ACTIVE_USERS_SHARE}
              chart={<Sparkline values={DEMO_ACTIVE_USERS_TREND} colour="#388FD4" />}
            />
            <StatTile
              label="Published rotas"
              value={data.publishedRotas.toLocaleString('en-GB')}
              hint="Across every tenant"
              chart={<Sparkline values={DEMO_PUBLISHED_ROTAS_TREND} colour="#1EA06B" />}
            />
            <StatTile
              label="Monthly revenue"
              value={DEMO_MONTHLY_REVENUE}
              hint={
                <>
                  <span className="font-semibold text-success">
                    {DEMO_REVENUE_CHANGE}
                  </span>{' '}
                  from last month
                </>
              }
              chart={<Sparkline values={DEMO_REVENUE_TREND} colour="#E0A030" />}
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
                <MeterRows
                  caption="Organisations by plan"
                  rows={DEMO_SUBSCRIPTION_MIX.map((r) => ({ ...r }))}
                />
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
                  caption="Organisations by health"
                  rows={DEMO_ORG_HEALTH.map((r) => ({ ...r }))}
                />
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
                    {DEMO_OPEN_CASES}
                  </p>
                </div>
                <div className="rounded-2xl border border-surface-border p-3.5 dark:border-surface-border-dark">
                  <p className="text-xs font-medium text-content-muted dark:text-content-muted-dark">
                    Urgent
                  </p>
                  <p className="mt-1 font-display text-[1.7rem] font-semibold leading-tight tabular-nums text-content dark:text-content-dark">
                    {DEMO_URGENT_CASES}
                  </p>
                </div>
              </div>

              <ul className="mt-3 space-y-3">
                {DEMO_CASES.map((item) => (
                  <li key={item.subject} className="flex gap-2.5">
                    <Badge
                      tone={CASE_TONE[item.priority]}
                      dot
                      className="mt-0.5 shrink-0"
                    >
                      {item.priority}
                    </Badge>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-snug text-content dark:text-content-dark">
                        {item.subject}
                      </span>
                      <span className="mt-0.5 block text-xs text-content-muted dark:text-content-muted-dark">
                        {item.meta}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
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
            computed. Organisation counts, growth, users, published rotas, support access
            and the audit feed are real.
          </p>
        </div>
      )}
    </AdminPage>
  );
}
