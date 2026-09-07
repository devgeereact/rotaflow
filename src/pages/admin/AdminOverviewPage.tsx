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
  getOperationsSummary,
  getPlatformGrowth,
  getPlatformTotals,
  listAllSubscriptions,
  listPlatformAuditLogs,
  type GrowthPoint as ServerGrowthPoint,
  type OperationsSummary,
} from '@/services/platformService';
import {
  getOrganisationFacets,
  type OrganisationFacets,
} from '@/services/platformDirectoryService';
import { listSupportAccessSessions } from '@/services/supportAccessService';
import { sessionStatus, type SupportAccessSession } from '@/lib/supportAccess';

import { listInvoices, listPlans, type Invoice } from '@/services/billingService';
import { listSupportCases, type SupportCaseRow } from '@/services/supportCaseService';
import { getHealthSummary, type HealthSummaryRow } from '@/services/platformFactsService';
import { formatMoney } from '@/lib/money';
import { downloadCsv } from '@/lib/csv';
import {
  collectedByMonth,
  monthlyRecurringPence,
  revenueByPlan,
  revenueChurnForMonth,
} from '@/lib/revenue';
import { HEALTH_LABEL } from '@/lib/tenantHealth';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { reportError } from '@/lib/sentry';
import type { AuditLog, Subscription } from '@/types';

/**
 * What the overview loaded, panel by panel, and which panels could not be.
 *
 * ## Why this is not one `Promise.all`
 *
 * It was. Eleven reads in one `Promise.all`, so a single failing one — a
 * refused RPC, a 500 on invoices — rejected the whole thing and the screen
 * showed nothing but a retry button. The dashboard's whole job is to say what
 * is happening, and losing every number because one of eleven providers was
 * unhappy is the worst moment to lose it.
 *
 * `Promise.allSettled` instead, with the failures named. A panel whose source
 * failed says so; the others carry on. This matters more than it looks: a
 * caught failure that renders as `0` is worse than one that renders as an
 * error, because a zero is a claim.
 */
interface Snapshot {
  totals: PlatformTotals | null;
  facets: OrganisationFacets | null;
  operations: OperationsSummary | null;
  growth: ServerGrowthPoint[] | null;
  subscriptions: Subscription[] | null;
  recentAudit: AuditLog[] | null;
  sessions: SupportAccessSession[] | null;
  plans: { code: string; monthly_price_pence: number }[] | null;
  invoices: Invoice[] | null;
  supportCases: SupportCaseRow[] | null;
  health: HealthSummaryRow[] | null;
  /** Human names of the sources that could not be read. */
  unavailable: string[];
}

interface PlatformTotals {
  organisations: number;
  activeOrgs: number;
  profiles: number;
  staffProfiles: number;
  publishedRotas: number;
  shiftsThisMonth: number;
}

/**
 * One panel's source could not be read.
 *
 * Not an empty state and not a zero. "No open cases" and "the open-case count
 * could not be read" are opposite facts and the second one used to render as
 * the first, because the whole page shared a single try/catch that turned
 * every failure into a blank screen or, once caught, into an optimistic
 * number.
 */
function UnavailablePanel({
  what,
  onRetry,
}: {
  what: string;
  onRetry: () => void;
}): JSX.Element {
  return (
    <div className="rounded-xl bg-warning-wash p-3 text-sm text-warning-ink dark:bg-warning-wash-dark dark:text-warning-ink-dark">
      <p>The {what} could not be read, so this panel is empty rather than zero.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1.5 text-xs font-semibold underline underline-offset-2"
      >
        Try again
      </button>
    </div>
  );
}

/** "Sep" from an ISO date. The chart's axis, in the database's UTC months. */
function monthLabel(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    timeZone: 'UTC',
  });
}

const ACTIVITY_ICON = {
  building: Building2,
  card: CreditCard,
  key: KeyRound,
  flag: Flag,
  plug: Plug,
} as const;

/**
 * Which icon a real audit row gets, from the first segment of its action.
 *
 * A prefix match rather than an exhaustive map: actions are namespaced
 * (`organisation.suspended`, `feature_flag.updated`), the list grows with every
 * writer added, and an unmapped action should still render, with the generic
 * mark rather than not at all.
 */
function activityIcon(
  action: string,
): (typeof ACTIVITY_ICON)[keyof typeof ACTIVITY_ICON] {
  const prefix = action.split('.')[0] ?? '';
  if (prefix.startsWith('organisation')) return ACTIVITY_ICON.building;
  if (prefix.startsWith('invoice') || prefix.startsWith('subscription'))
    return ACTIVITY_ICON.card;
  if (prefix.startsWith('support_access') || prefix.startsWith('platform_role'))
    return ACTIVITY_ICON.key;
  if (prefix.startsWith('feature_flag')) return ACTIVITY_ICON.flag;
  return ACTIVITY_ICON.plug;
}

/**
 * Tone for a row in the activity feed. Named for what it is now rather than
 * where it came from: it lived in `adminOverviewDemo.ts` as `DemoActivityTone`,
 * and outlived that file because it was never demo data — just a colour union
 * the feed shares with `Badge`.
 */
type ActivityTone = 'success' | 'info' | 'warning' | 'danger';

const SEVERITY_TONE: Record<string, ActivityTone> = {
  info: 'info',
  notice: 'info',
  warning: 'warning',
  critical: 'danger',
};

const ACTIVITY_TONE: Record<ActivityTone, string> = {
  success: 'bg-success-wash text-success dark:bg-success-wash-dark',
  info: 'bg-primary-wash text-primary-ink dark:bg-primary-wash-dark dark:text-primary-ink-dark',
  warning:
    'bg-warning-wash text-warning-ink dark:bg-warning-wash-dark dark:text-warning-ink-dark',
  danger: 'bg-danger-wash text-danger dark:bg-danger-wash-dark',
};

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
 * `/admin`. NEW_STRUCTURE §34's platform dashboard, built to the full shape of
 * `docs/PLATFORM_CONSOLE.html`.
 *
 * ## Which figures are real
 *
 * Organisation counts, the twelve-month growth series, total users, memberships,
 * subscriptions, revenue and the plan mix, published rotas, the support queue,
 * open support-access sessions, the audit feed and churn (both the "Churned"
 * count series on the growth chart and the revenue-churn percentage in its
 * caption) all come from the database.
 *
 * System health too, since BUG-059: the per-service list is
 * `platform_health_summary` over `platform_health_samples`, not the invented
 * six-service list with fabricated hourly history strips that used to sit
 * there. It shows "Not sampled" where nothing has been measured, because an
 * uptime of 100% over zero observations is the most flattering possible
 * reading of having measured nothing.
 *
 * ## What is still worth knowing
 *
 * Nothing here is invented any more. The remaining caveat is frequency, not
 * truthfulness: samples are written when an administrator opens System status,
 * so health reflects the moments somebody looked. A scheduled probe is
 * GAP-011.
 */
export function AdminOverviewPage(): JSX.Element {
  const [data, setData] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [periodMonths, setPeriodMonths] = useState(12);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setData(null);
    void (async () => {
      // Named, so a failure can be reported as "subscriptions could not be
      // read" rather than as a generic error with no clue which panel to
      // distrust.
      const sources = [
        ['tenant and account totals', getPlatformTotals()],
        ['organisation health', getOrganisationFacets()],
        ['support and incidents', getOperationsSummary()],
        ['growth', getPlatformGrowth(periodMonths)],
        ['subscriptions', listAllSubscriptions()],
        ['recent activity', listPlatformAuditLogs(4)],
        ['support access', listSupportAccessSessions(20)],
        ['plans', listPlans()],
        ['invoices', listInvoices()],
        ['support cases', listSupportCases()],
        ['service health', getHealthSummary()],
      ] as const;

      const settled = await Promise.allSettled(sources.map(([, promise]) => promise));
      if (!active) return;

      const unavailable: string[] = [];
      const value = <T,>(index: number): T | null => {
        const result = settled[index];
        if (result?.status === 'fulfilled') return result.value as T;
        if (result?.status === 'rejected') {
          reportError(result.reason, {
            area: `admin:overview:${sources[index]?.[0] ?? 'unknown'}`,
          });
        }
        const name = sources[index]?.[0];
        if (name) unavailable.push(name);
        return null;
      };

      const snapshot: Snapshot = {
        totals: value<PlatformTotals>(0),
        facets: value<OrganisationFacets>(1),
        operations: value<OperationsSummary>(2),
        growth: value<ServerGrowthPoint[]>(3),
        subscriptions: value<Subscription[]>(4),
        recentAudit: value<AuditLog[]>(5),
        sessions: value<SupportAccessSession[]>(6),
        plans: value<{ code: string; monthly_price_pence: number }[]>(7),
        invoices: value<Invoice[]>(8),
        supportCases: value<SupportCaseRow[]>(9),
        health: value<HealthSummaryRow[]>(10),
        unavailable,
      };

      // Only a total failure is a failed page. Anything less renders what it
      // has and names what it does not.
      if (unavailable.length === sources.length) {
        setFailed(true);
        return;
      }
      setData(snapshot);
    })();
    return () => {
      active = false;
    };
  }, [reloadKey, periodMonths]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  const derived = useMemo(() => {
    if (!data) return null;
    const now = new Date();
    const planPrices = new Map(
      (data.plans ?? []).map((plan) => [plan.code, plan.monthly_price_pence]),
    );
    // Every figure below is `null` when its source could not be read, and the
    // tiles render that as "unavailable" rather than as zero. A zero is a
    // claim, and a claim made out of a failed request is the specific lie
    // this dashboard used to tell.
    const growth = data.growth;
    // From the facets, not from `platform_totals`, which answers the same
    // question. Two sources for one number is two numbers, and the screen was
    // showing both: "6 organisations" beside "34 tenants".
    const total = data.facets?.total ?? data.totals?.organisations ?? null;
    const active = data.facets?.active ?? data.totals?.activeOrgs ?? null;
    const subscriptions = data.subscriptions;

    return {
      growth,
      active,
      total,
      churnCounts: growth?.map((point) => point.churned) ?? null,
      activeShare:
        total !== null && active !== null
          ? total > 0
            ? `${((active / total) * 100).toFixed(1)}% of all tenants`
            : 'No tenants yet'
          : null,
      newThisMonth: growth ? (growth[growth.length - 1]?.created ?? 0) : null,

      // Revenue and the support queue are real tables (0023, 0024), so the
      // overview computes them from the same functions Billing and the Support
      // Centre use. Two screens quoting one number is only safe when they share
      // the arithmetic.
      mrr: subscriptions ? monthlyRecurringPence(subscriptions, planPrices) : null,
      churnThisMonth: subscriptions
        ? revenueChurnForMonth(
            subscriptions,
            planPrices,
            new Date(now.getFullYear(), now.getMonth(), 1),
            new Date(now.getFullYear(), now.getMonth() + 1, 1),
          )
        : null,
      revenueTrend: data.invoices
        ? collectedByMonth(data.invoices, periodMonths, now).map((t) =>
            Math.round(t.pence / 100),
          )
        : null,
      planMix: subscriptions ? revenueByPlan(subscriptions, planPrices) : null,

      // Counts, from a server aggregate. `listSupportCases()` returns up to
      // two hundred rows so the screen could count the open ones, which is
      // both the wrong way to ask and a cap: three hundred open cases reported
      // as two hundred.
      openCases: data.operations?.openCases ?? null,
      urgentCases: data.operations?.urgentOpenCases ?? null,
      openIncidents: data.operations?.openIncidents ?? null,
      failedNotifications: data.operations?.failedNotifications ?? null,
      recentCases: data.supportCases?.slice(0, 4) ?? null,

      // `organisations.last_activity_at` is maintained by touch_org_activity()
      // (0023), so tenant activity is measurable. Per-*user* activity still is
      // not. Nothing records a session, so the tile counts tenants and says
      // so rather than reporting a number of people nobody observed.
      activeTenants: data.facets?.active24h ?? null,
      health: data.facets
        ? (
            [
              ['healthy', data.facets.healthy],
              ['attention', data.facets.attention],
              ['at_risk', data.facets.atRisk],
              ['suspended', data.facets.suspended],
              ['archived', data.facets.archivedBand],
            ] as const
          ).map(([band, count]) => ({ band, label: HEALTH_LABEL[band], count }))
        : null,
      openSessions:
        data.operations?.activeSupportSessions ??
        (data.sessions
          ? data.sessions.filter((session) => sessionStatus(session, now) === 'active')
              .length
          : null),
    };
  }, [data, periodMonths]);

  /**
   * A figure whose source may not have loaded.
   *
   * An em dash, never a zero. A dashboard that renders a failed read as `0`
   * makes a claim it has no evidence for, and "no open cases" is exactly the
   * claim somebody acts on by going home.
   */
  const figure = (value: number | null): string =>
    value === null ? '—' : value.toLocaleString('en-GB');

  const exportReport = useCallback(() => {
    if (!derived?.growth) return;
    downloadCsv(
      `platform-overview_${new Date().toISOString().slice(0, 10)}`,
      derived.growth,
      [
        { label: 'Month (UTC)', value: (g) => g.monthStart },
        { label: 'Total organisations', value: (g) => String(g.total) },
        { label: 'New organisations', value: (g) => String(g.created) },
        { label: 'Churned subscriptions', value: (g) => String(g.churned) },
      ],
      {
        notes: [
          `RotaFlow platform growth, generated ${new Date().toISOString()}`,
          'Months are UTC. Churn counts a cancellation once the subscription has stopped, not when one was requested.',
        ],
      },
    );
  }, [derived]);

  return (
    <AdminPage
      title="Platform overview"
      description="Organisations, users, subscriptions and platform performance across every RotaFlow tenant."
      action={
        <>
          <Select
            aria-label="Reporting period"
            className="w-auto"
            value={String(periodMonths)}
            onChange={(e) => setPeriodMonths(Number(e.target.value))}
          >
            <option value="12">Last 12 months</option>
            <option value="3">Last 3 months</option>
            <option value="1">Last month</option>
          </Select>
          <Button variant="secondary" onClick={exportReport} disabled={!derived}>
            Export report
          </Button>
        </>
      }
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !data || !derived ? (
        <AdminLoading variant="tiles" />
      ) : (
        <div className="space-y-4">
          {data.unavailable.length > 0 && (
            <div
              role="status"
              className="rounded-2xl bg-warning-wash p-3 text-sm text-warning-ink dark:bg-warning-wash-dark dark:text-warning-ink-dark"
            >
              <p>
                {data.unavailable.length === 1
                  ? `The ${data.unavailable[0]} could not be read.`
                  : `${data.unavailable.length} sources could not be read: ${data.unavailable.join(', ')}.`}{' '}
                Everything else on this page loaded. The panels those feed are empty
                rather than zero.
              </p>
              <button
                type="button"
                onClick={retry}
                className="mt-1.5 text-xs font-semibold underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          )}

          <TileGrid>
            <StatTile
              label="Total organisations"
              value={figure(derived.total)}
              hint={
                derived.newThisMonth === null ? (
                  'Growth could not be read'
                ) : (
                  <>
                    <span className="font-semibold text-success-ink dark:text-success-ink-dark">
                      +{derived.newThisMonth}
                    </span>{' '}
                    this month
                  </>
                )
              }
              to="/admin/organisations"
              chart={
                derived.growth ? (
                  <Sparkline values={derived.growth.map((g) => g.total)} />
                ) : undefined
              }
            />
            <StatTile
              label="Active organisations"
              value={figure(derived.active)}
              hint={derived.activeShare ?? 'Totals could not be read'}
              to="/admin/organisations"
              chart={
                derived.growth ? (
                  <Sparkline
                    values={derived.growth.map((g) => g.total)}
                    colour="#1EA06B"
                  />
                ) : undefined
              }
            />
            <StatTile
              label="Total users"
              value={figure(data.totals?.profiles ?? null)}
              hint="Accounts across every organisation"
              to="/admin/users"
            />
            <StatTile
              label="Tenants active today"
              value={figure(derived.activeTenants)}
              hint={
                derived.activeTenants !== null && derived.total
                  ? `${((derived.activeTenants / derived.total) * 100).toFixed(0)}% of all tenants`
                  : derived.activeTenants === null
                    ? 'Activity could not be read'
                    : 'No tenants yet'
              }
              to="/admin/organisations"
            />
            <StatTile
              label="Published rotas"
              value={figure(data.totals?.publishedRotas ?? null)}
              hint="Across every tenant"
            />
            <StatTile
              label="Monthly recurring revenue"
              value={derived.mrr === null ? '—' : formatMoney(derived.mrr)}
              hint={
                derived.mrr === null
                  ? 'Subscriptions could not be read'
                  : 'Active and past due'
              }
              to="/admin/billing"
              chart={
                derived.revenueTrend ? (
                  <Sparkline values={derived.revenueTrend} colour="#E0A030" />
                ) : undefined
              }
            />
          </TileGrid>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              className="lg:col-span-2"
              title="Platform growth"
              actions={
                <Badge tone="neutral">
                  {periodMonths === 1 ? 'Last month' : `Last ${periodMonths} months`}
                </Badge>
              }
            >
              {derived.growth === null ? (
                <UnavailablePanel what="growth" onRetry={retry} />
              ) : (
                <>
                  <TrendChart
                    title="Organisations created and total, by month"
                    labels={derived.growth.map((g) => monthLabel(g.monthStart))}
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
                        values: derived.churnCounts ?? [],
                        colour: '#D94A3A',
                        lineOnly: true,
                      },
                    ]}
                    height={310}
                  />
                  <p className="mt-1 text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
                    Counted in the database over every tenant, in UTC months, so this
                    chart reads the same for everybody. New organisations are counted in
                    the month they signed up and the current month is partial. Churned
                    counts a cancellation once its subscription has actually stopped, not
                    when one was requested
                    {derived.churnThisMonth !== null &&
                      ` — ${derived.churnThisMonth}% of MRR lost so far this month`}
                    .
                  </p>
                </>
              )}
            </Panel>

            <div className="grid content-start gap-4">
              <Panel title="Subscription mix">
                {derived.planMix === null ? (
                  <UnavailablePanel what="subscriptions" onRetry={retry} />
                ) : derived.planMix.length === 0 ? (
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
                    className="text-xs font-medium text-primary-ink hover:underline dark:text-primary-ink-dark"
                  >
                    Review
                  </Link>
                }
              >
                {derived.health === null ? (
                  <UnavailablePanel what="organisation health" onRetry={retry} />
                ) : (
                  <MeterRows
                    caption="Organisations by account health"
                    rows={derived.health.map((row) => ({
                      label: row.label,
                      value: row.count,
                      colour: HEALTH_COLOUR[row.band],
                    }))}
                  />
                )}
                <p className="mt-3 text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
                  From account status, subscription state and last activity: suspended
                  first, then a failed payment, then silence. Over a fortnight needs
                  attention, over a month is at risk.
                </p>
              </Panel>
            </div>
          </div>

          {/* Three equal columns that stretch to the tallest, as the reference
              lays them out, `h-full` on each panel rather than a fixed height.

              Which makes the tallest card everyone else's problem. The audit
              feed asked for eight entries and its rows run to two lines each,
              so it stood 529px tall and set a 584px row. System health drew
              six services in 265px and left 202 empty below them; Support drew
              its tiles and cases in 313 and left 154. The short cards looked
              broken, and the cause was in neither of them.

              Four entries sits the feed between the other two: measured bodies
              are now 265, 296 and 313 in a 368px row, where they were 265, 529
              and 313 in a 584px one. The rest of the log was never the point of
              an overview panel carrying an "Audit log" link in its corner. */}
          <div className="grid items-stretch gap-4 lg:grid-cols-3">
            <Panel
              className="h-full"
              title="System health"
              actions={
                <Link
                  to="/admin/platform-health"
                  className="text-xs font-medium text-primary-ink hover:underline dark:text-primary-ink-dark"
                >
                  All services
                </Link>
              }
              flush
            >
              {data.health === null ? (
                <div className="px-4 py-3">
                  <UnavailablePanel what="service health" onRetry={retry} />
                </div>
              ) : data.health.length === 0 ? (
                <p className="px-4 py-3 text-sm text-content-muted dark:text-content-muted-dark">
                  Nothing has been sampled in the last 24 hours. Samples are written when
                  System status runs its checks, so opening that screen is currently what
                  measures the platform.
                </p>
              ) : (
                <ul>
                  {data.health.map((service) => {
                    // Degraded at anything below four nines over the window.
                    // A threshold rather than a stored status, because the view
                    // aggregates samples and does not carry one.
                    const uptime = service.uptime_pct_24h;
                    const healthy = uptime === null || uptime >= 99.9;
                    return (
                      <li
                        key={service.service}
                        className="flex items-center gap-2.5 border-b border-divider px-4 py-2.5 last:border-0 dark:border-divider-dark"
                      >
                        <span className="text-sm font-semibold text-content dark:text-content-dark">
                          {service.service}
                        </span>
                        <Badge tone={healthy ? 'success' : 'warning'} dot>
                          {healthy ? 'Operational' : 'Degraded'}
                        </Badge>
                        <span className="ml-auto font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
                          {uptime === null
                            ? 'Not sampled'
                            : `${uptime}% · ${service.samples_24h ?? 0} samples`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel
              className="h-full"
              title="Platform activity"
              actions={
                <Link
                  to="/admin/audit"
                  className="text-xs font-medium text-primary-ink hover:underline dark:text-primary-ink-dark"
                >
                  Audit log
                </Link>
              }
              flush
            >
              <ul>
                {data.recentAudit === null ? (
                  <li className="px-4 py-3">
                    <UnavailablePanel what="recent activity" onRetry={retry} />
                  </li>
                ) : data.recentAudit.length === 0 ? (
                  <li className="px-4 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
                    Nothing has been recorded yet.
                  </li>
                ) : (
                  data.recentAudit.map((entry) => {
                    const Icon = activityIcon(entry.action);
                    const change =
                      entry.before_value && entry.after_value
                        ? `${entry.before_value} → ${entry.after_value}`
                        : (entry.after_value ?? entry.entity_type ?? '');
                    return (
                      <li
                        key={entry.id}
                        className="flex gap-3 border-b border-divider px-4 py-2.5 last:border-0 dark:border-divider-dark"
                      >
                        <span
                          className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                            ACTIVITY_TONE[SEVERITY_TONE[entry.severity] ?? 'info']
                          }`}
                        >
                          <Icon size={14} aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm leading-snug text-content dark:text-content-dark">
                            {entry.action}
                            {entry.org_name ? ` · ${entry.org_name}` : ''}
                          </span>
                          <span className="mt-0.5 block text-xs text-content-muted dark:text-content-muted-dark">
                            {[
                              change,
                              entry.actor_name ?? 'System',
                              new Date(entry.created_at).toLocaleString('en-GB'),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                      </li>
                    );
                  })
                )}
              </ul>
            </Panel>

            <Panel
              className="h-full"
              title="Support"
              actions={
                <Link
                  to="/admin/support"
                  className="text-xs font-medium text-primary-ink hover:underline dark:text-primary-ink-dark"
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
                    {figure(derived.openCases)}
                  </p>
                </div>
                <div className="rounded-2xl border border-surface-border p-3.5 dark:border-surface-border-dark">
                  <p className="text-xs font-medium text-content-muted dark:text-content-muted-dark">
                    Urgent
                  </p>
                  <p className="mt-1 font-display text-[1.7rem] font-semibold leading-tight tabular-nums text-content dark:text-content-dark">
                    {figure(derived.urgentCases)}
                  </p>
                </div>
              </div>

              {derived.recentCases === null ? (
                <div className="mt-3">
                  <UnavailablePanel what="support cases" onRetry={retry} />
                </div>
              ) : derived.recentCases.length === 0 ? (
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

          {/* This paragraph used to name the sections whose figures were
              invented. There are none left (BUG-059), so it now says what the
              remaining caveat actually is — which is about how often the
              platform is measured, not about whether the numbers are real. */}
          <p className="text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
            <span className="font-semibold text-content dark:text-content-dark">
              Every figure on this screen is measured.
            </span>{' '}
            Organisation counts and growth, users, published rotas, recurring revenue and
            the subscription mix from <code>subscriptions × plans</code>, the support
            queue, support access and the audit feed all come from the database. System
            health is computed from <code>platform_health_samples</code>, which are
            written when an administrator opens System status — so it reflects the moments
            somebody looked, and reads &ldquo;Not sampled&rdquo; rather than 100% when
            nobody has.
          </p>
        </div>
      )}
    </AdminPage>
  );
}
