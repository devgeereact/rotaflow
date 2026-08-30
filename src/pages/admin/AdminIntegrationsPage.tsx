import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, MinusCircle } from 'lucide-react';
import { Panel } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import { runHealthChecks } from '@/services/platformHealthService';
import { listAllSmtpSettings } from '@/services/smtpSettingsService';
import { listAllOrganisations } from '@/services/platformService';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { Button } from '@/components/ui/Button';
import { listConnectorStats, type ConnectorStats } from '@/services/integrationService';
import { reportError } from '@/lib/sentry';
import type { HealthCheck } from '@/lib/platformHealth';
import type { Organisation, OrgSmtpSettingsSafe } from '@/types';

/**
 * `/admin/integrations`. What this deployment is wired to, and which tenants
 * have wired something of their own.
 *
 * ## Two different kinds of integration, kept apart
 *
 * **Platform services** are build-time configuration: Sentry, ImageKit,
 * Inngest, push keys. They are the same entries `/admin/platform-health`
 * reports as "configured", read from the same source, and they answer "will
 * this deployment try to use the service". They do **not** prove the far end is
 * up. Nothing here probes it, and a green tick that means "a key is present"
 * must not be mistaken for one that means "we just called it".
 *
 * **Tenant integrations** are rows a customer created. There is exactly one:
 * per-organisation SMTP. Everything else the console reference lists. Payroll,
 * HR, calendar, identity, webhooks. Has no table holding a connection, a sync
 * state or a failure count, so those connectors are absent rather than listed
 * with a fabricated success rate.
 */
export function AdminIntegrationsPage(): JSX.Element {
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [smtp, setSmtp] = useState<OrgSmtpSettingsSafe[]>([]);
  const [connectors, setConnectors] = useState<ConnectorStats[]>([]);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setChecks(null);
    setLoaded(false);
    void (async () => {
      try {
        // Deliberately not one `Promise.all`.
        //
        // `runHealthChecks` probes the realtime socket and waits up to eight
        // seconds for a handshake. Awaiting it alongside the reads meant the
        // entire screen. Tiles, SMTP list, everything, sat on a skeleton for
        // eight seconds while data that had arrived in 40ms was held back. The
        // reads render immediately; the services panel fills in when it can.
        const [smtpRows, orgs, connectorRows] = await Promise.all([
          listAllSmtpSettings(),
          listAllOrganisations(),
          // Aggregated in Postgres by `integration_connector_stats`. Pulling
          // 812 sync runs to a browser to divide two numbers is the same
          // answer at a hundred times the cost, and it gets worse every day
          // the product runs.
          listConnectorStats(),
        ]);
        if (!active) return;
        setSmtp(smtpRows);
        setOrganisations(orgs);
        setConnectors(connectorRows);
        setLoaded(true);

        const health = await runHealthChecks();
        if (!active) return;
        setChecks(health);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:integrations' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  /**
   * The estate totals, summed from the per-connector view.
   *
   * `medianMs` is a median of medians rather than a true median, which is
   * close enough for a tile and honest about what it is: the alternative is
   * reading every run to compute one number nobody sorts by.
   */
  const totals = useMemo(() => {
    const medians = connectors
      .map((c) => c.median_duration_ms)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    return {
      orgsConnected: connectors.reduce((t, c) => t + (c.orgs_connected ?? 0), 0),
      runs24h: connectors.reduce((t, c) => t + (c.runs_24h ?? 0), 0),
      failed24h: connectors.reduce((t, c) => t + (c.failed_24h ?? 0), 0),
      // 'planned' (0073) means the connector does not exist yet. Counting what
      // is BUILT is the number an administrator needs first — a catalogue of
      // eight with none built reads very differently from eight running ones,
      // and the old "Degraded: 0 / All operational" tile said the opposite.
      built: connectors.filter((c) => c.status !== 'planned').length,
      degraded: connectors.filter((c) => c.status === 'degraded' || c.status === 'down')
        .length,
      medianMs: medians.length === 0 ? null : medians[Math.floor(medians.length / 2)]!,
    };
  }, [connectors]);

  const orgById = useMemo(
    () => new Map(organisations.map((o) => [o.id, o])),
    [organisations],
  );

  const platform = useMemo(
    () => (checks ?? []).filter((c) => c.configuredOnly),
    [checks],
  );

  return (
    <AdminPage
      title="Integrations"
      description="Connector health across every tenant. A failing connector is a silent data problem, so failures are counted, not just flagged."
      action={
        <Button disabled title="Nothing records a sync, so there is nothing to retry">
          Retry all failed
        </Button>
      }
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !loaded ? (
        <AdminLoading variant="tiles" rows={4} />
      ) : (
        <div className="space-y-4">
          <TileGrid>
            <StatTile label="Connectors" value={connectors.length} />
            <StatTile
              label="Organisations connected"
              value={totals.orgsConnected.toLocaleString('en-GB')}
              hint="Distinct tenants with a live connection"
            />
            <StatTile
              label="Syncs, 24h"
              value={totals.runs24h.toLocaleString('en-GB')}
              hint="Across every connector"
            />
            <StatTile
              label="Failed, 24h"
              value={totals.failed24h}
              hint={
                totals.failed24h > 0 ? (
                  <span className="font-semibold text-danger-ink dark:text-danger-ink-dark">
                    Needs attention
                  </span>
                ) : (
                  'Nothing failed'
                )
              }
            />
            <StatTile
              label="Built"
              value={`${totals.built} of ${connectors.length}`}
              hint={
                totals.degraded > 0 ? (
                  <span className="font-semibold text-warning-ink dark:text-warning-ink-dark">
                    {totals.degraded} degraded
                  </span>
                ) : totals.built === 0 ? (
                  'The rest are planned, not running'
                ) : (
                  'None degraded'
                )
              }
            />
            <StatTile
              label="Median sync"
              value={
                totals.medianMs === null ? '-' : `${(totals.medianMs / 1000).toFixed(1)}s`
              }
              hint={
                totals.medianMs === null
                  ? 'Nothing synced in seven days'
                  : 'Last seven days'
              }
            />
          </TileGrid>

          <Panel title="Connector status" flush>
            <div className="overflow-x-auto">
              <table className="w-full table-fixed border-collapse text-sm">
                <caption className="sr-only">
                  Connector status across every tenant
                </caption>
                <colgroup>
                  {/* Three action buttons need real width; `table-fixed` will not
                      grant it, so the Failed figure was overrun by them. */}
                  {[
                    'w-[15%]',
                    'w-[10%]',
                    'w-[10%]',
                    'w-[11%]',
                    'w-[10%]',
                    'w-[13%]',
                    'w-[6%]',
                    'w-[25%]',
                  ].map((w) => (
                    <col key={w} className={w} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="border-b border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
                    {[
                      ['Integration', 'left'],
                      ['Category', 'left'],
                      ['Organisations', 'right'],
                      ['Status', 'left'],
                      ['Success rate', 'right'],
                      ['Last sync', 'left'],
                      ['Failed', 'right'],
                      ['Median sync', 'right'],
                    ].map(([heading, align]) => (
                      <th
                        key={heading}
                        className={`px-3 py-2.5 text-[0.69rem] font-semibold uppercase tracking-[0.06em] text-content-muted first:pl-4 dark:text-content-muted-dark ${
                          align === 'right' ? 'text-right' : 'text-left'
                        }`}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {connectors.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark"
                      >
                        No connector is in the catalogue.
                      </td>
                    </tr>
                  ) : (
                    connectors.map((connector) => (
                      <tr
                        key={connector.key ?? connector.name}
                        className="border-b border-divider last:border-0 dark:border-divider-dark"
                      >
                        <td className="px-3 py-2.5 pl-4 font-medium text-content dark:text-content-dark">
                          {connector.name}
                        </td>
                        <td className="px-3 py-2.5 capitalize text-content-muted dark:text-content-muted-dark">
                          {connector.category}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-content dark:text-content-dark">
                          {(connector.orgs_connected ?? 0).toLocaleString('en-GB')}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge
                            tone={
                              connector.status === 'operational'
                                ? 'success'
                                : connector.status === 'beta'
                                  ? 'info'
                                  : // 'planned' is not a warning — nothing is
                                    // wrong with a connector nobody has built.
                                    connector.status === 'planned'
                                    ? 'neutral'
                                    : 'warning'
                            }
                            dot
                          >
                            {(connector.status ?? 'unknown').charAt(0).toUpperCase() +
                              (connector.status ?? 'unknown').slice(1)}
                          </Badge>
                        </td>
                        {/* Null rather than 100% when nothing ran: a connector
                            nobody used is not one that worked perfectly. */}
                        <td
                          className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                            (connector.success_rate_7d ?? 100) < 95
                              ? 'text-danger-ink dark:text-danger-ink-dark'
                              : 'text-content dark:text-content-dark'
                          }`}
                        >
                          {connector.success_rate_7d === null
                            ? '-'
                            : `${connector.success_rate_7d}%`}
                        </td>
                        <td className="px-3 py-2.5 text-content-muted dark:text-content-muted-dark">
                          {connector.last_sync_at
                            ? new Date(connector.last_sync_at).toLocaleString('en-GB', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : 'Never'}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                            connector.failed_24h
                              ? 'font-semibold text-danger-ink dark:text-danger-ink-dark'
                              : 'text-content-muted dark:text-content-muted-dark'
                          }`}
                        >
                          {connector.failed_24h ?? 0}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-content-muted dark:text-content-muted-dark">
                          {connector.median_duration_ms === null
                            ? '-'
                            : `${(connector.median_duration_ms / 1000).toFixed(1)}s`}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Platform services. Real" flush>
            <p className="border-b border-divider px-4 py-2.5 text-sm text-content-muted dark:border-divider-dark dark:text-content-muted-dark">
              Read from this deployment&rsquo;s build configuration. A key being present
              proves it will try to use the service, for whether it answers, see{' '}
              <Link
                to="/admin/platform-health"
                className="text-primary-ink underline underline-offset-2 dark:text-primary-ink-dark"
              >
                System Status
              </Link>
              .
            </p>
            <ul>
              {platform.map((check) => (
                <li
                  key={check.name}
                  className="flex flex-wrap items-center gap-3 border-b border-divider px-4 py-3 last:border-0 dark:border-divider-dark"
                >
                  {check.status === 'operational' ? (
                    <CheckCircle2
                      size={17}
                      aria-hidden="true"
                      className="shrink-0 text-success"
                    />
                  ) : (
                    <MinusCircle
                      size={17}
                      aria-hidden="true"
                      className="shrink-0 text-content-muted dark:text-content-muted-dark"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-content dark:text-content-dark">
                      {check.name}
                    </p>
                    <p className="text-sm text-content-muted dark:text-content-muted-dark">
                      {check.detail}
                    </p>
                  </div>
                  <Badge tone={check.status === 'operational' ? 'success' : 'neutral'}>
                    {check.status === 'operational' ? 'Configured' : 'Not configured'}
                  </Badge>
                </li>
              ))}
              {platform.length === 0 && (
                <li className="px-4 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
                  {checks
                    ? 'No optional service is configured.'
                    : 'Reading configuration…'}
                </li>
              )}
            </ul>
          </Panel>

          <Panel title="Tenant mail settings (SMTP)" flush>
            {smtp.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
                No organisation has configured its own SMTP. All mail goes out on the
                platform sender.
              </p>
            ) : (
              <ul>
                {smtp.map((row) => {
                  const org = row.org_id ? orgById.get(row.org_id) : undefined;
                  return (
                    <li
                      key={row.org_id}
                      className="flex flex-wrap items-center gap-2 border-b border-divider px-4 py-3 last:border-0 dark:border-divider-dark"
                    >
                      {org ? (
                        <Link
                          to={`/admin/organisations/${org.id}`}
                          className="text-sm font-medium text-content hover:text-primary dark:text-primary-ink-dark dark:text-content-dark"
                        >
                          {org.name}
                        </Link>
                      ) : (
                        <span className="text-sm text-content-muted dark:text-content-muted-dark">
                          Unknown organisation
                        </span>
                      )}
                      <span className="font-mono text-xs text-content-muted dark:text-content-muted-dark">
                        {row.smtp_host}:{row.smtp_port}
                      </span>
                      <span className="font-mono text-xs text-content-muted dark:text-content-muted-dark">
                        {row.from_email}
                      </span>
                      <Badge tone={row.verified_at ? 'success' : 'warning'} dot>
                        {row.verified_at ? 'Verified' : 'Never tested'}
                      </Badge>
                      <span className="ml-auto font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
                        {row.updated_at
                          ? new Date(row.updated_at).toLocaleDateString('en-GB')
                          : 'Never'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="border-t border-divider px-4 py-2.5 text-xs text-content-muted dark:border-divider-dark dark:text-content-muted-dark">
              Passwords are omitted at the column level by{' '}
              <code>org_smtp_settings_safe</code>, so the console cannot read one even by
              widening this query.
            </p>
          </Panel>

          <Callout tone="info" title="Where these figures come from">
            <p>
              Organisations connected, success rate, failures and median duration are
              aggregated by <code>integration_connector_stats</code>, a view over{' '}
              <code>org_integrations</code> and <code>integration_sync_runs</code>. A
              success rate reads as a dash rather than 100% when nothing ran in seven
              days, because a connector nobody used is not one that worked perfectly.
            </p>
            <p>
              Every connector in the catalogue carries{' '}
              <code>status = &lsquo;planned&rsquo;</code> and{' '}
              <code>available = false</code> (migration <code>0073</code>): none of them
              exists, no Edge Function talks to Sage, Xero or BrightHR, and{' '}
              <code>integration_sync_runs</code> has never had a writer. They were
              previously seeded as &ldquo;operational&rdquo;, &ldquo;degraded&rdquo; and
              &ldquo;beta&rdquo;, which described software that was never written — and
              because <code>connect_integration</code> checks <code>available</code>, the
              database would have let an owner connect Sage Payroll and then sync nothing
              indefinitely. It now refuses.
            </p>
            <p>
              The nearest real integration is the CSV payroll export a manager downloads
              from Reports, which is a file rather than a connection and has nothing to
              monitor. Setting a connector to anything other than <code>planned</code>{' '}
              asserts running code; do not do it until there is an Edge Function behind
              it.
            </p>
          </Callout>
        </div>
      )}
    </AdminPage>
  );
}
