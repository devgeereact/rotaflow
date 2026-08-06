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
import {
  DEMO_CONNECTORS,
  DEMO_DEGRADED_HINT,
  DEMO_FAILED_24H,
  DEMO_FAILED_24H_HINT,
  DEMO_MEDIAN_SYNC,
  DEMO_ORGS_CONNECTED,
  DEMO_ORGS_CONNECTED_HINT,
  DEMO_SYNCS_24H,
} from '@/lib/adminOverviewDemo';
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
        const [smtpRows, orgs] = await Promise.all([
          listAllSmtpSettings(),
          listAllOrganisations(),
        ]);
        if (!active) return;
        setSmtp(smtpRows);
        setOrganisations(orgs);
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
            <StatTile label="Connectors" value={DEMO_CONNECTORS.length} />
            <StatTile
              label="Organisations connected"
              value={DEMO_ORGS_CONNECTED.toLocaleString('en-GB')}
              hint={DEMO_ORGS_CONNECTED_HINT}
            />
            <StatTile label="Syncs, 24h" value={DEMO_SYNCS_24H.toLocaleString('en-GB')} />
            <StatTile
              label="Failed, 24h"
              value={DEMO_FAILED_24H}
              hint={
                <span className="font-semibold text-danger">{DEMO_FAILED_24H_HINT}</span>
              }
            />
            <StatTile
              label="Degraded"
              value={DEMO_CONNECTORS.filter((c) => c.status === 'degraded').length}
              hint={
                <span className="font-semibold text-danger">{DEMO_DEGRADED_HINT}</span>
              }
            />
            <StatTile label="Median sync" value={DEMO_MEDIAN_SYNC} />
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
                      ['Actions', 'right'],
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
                  {DEMO_CONNECTORS.map((connector) => (
                    <tr
                      key={connector.name}
                      className="border-b border-divider last:border-0 dark:border-divider-dark"
                    >
                      <td className="px-3 py-2.5 pl-4 font-medium text-content dark:text-content-dark">
                        {connector.name}
                      </td>
                      <td className="px-3 py-2.5 text-content-muted dark:text-content-muted-dark">
                        {connector.category}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-content dark:text-content-dark">
                        {connector.organisations.toLocaleString('en-GB')}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          tone={
                            connector.status === 'operational' ? 'success' : 'warning'
                          }
                          dot
                        >
                          {connector.status === 'operational'
                            ? 'Operational'
                            : 'Degraded'}
                        </Badge>
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                          connector.successRate < 95
                            ? 'text-danger'
                            : 'text-content dark:text-content-dark'
                        }`}
                      >
                        {connector.successRate}%
                      </td>
                      <td className="px-3 py-2.5 text-content-muted dark:text-content-muted-dark">
                        {connector.lastSync}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                          connector.failed
                            ? 'font-semibold text-danger'
                            : 'text-content-muted dark:text-content-muted-dark'
                        }`}
                      >
                        {connector.failed}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex justify-end gap-1.5">
                          {['Logs', 'Retry', 'Disable'].map((label) => (
                            <span
                              key={label}
                              title="No table records a sync, an attempt or a failure"
                              className={`cursor-not-allowed whitespace-nowrap rounded-lg border px-2 py-1 text-xs font-medium opacity-60 ${
                                label === 'Disable'
                                  ? 'border-danger/34 text-danger'
                                  : 'border-surface-border text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark'
                              }`}
                            >
                              {label}
                            </span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Platform services. Real" flush>
            <p className="border-b border-divider px-4 py-2.5 text-sm text-content-muted dark:border-divider-dark dark:text-content-muted-dark">
              Read from this deployment&rsquo;s build configuration. A key being present
              proves it will try to use the service, for whether it answers, see{' '}
              <Link to="/admin/platform-health" className="text-primary hover:underline">
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
                  const org = orgById.get(row.org_id);
                  return (
                    <li
                      key={row.org_id}
                      className="flex flex-wrap items-center gap-2 border-b border-divider px-4 py-3 last:border-0 dark:border-divider-dark"
                    >
                      {org ? (
                        <Link
                          to={`/admin/organisations/${org.id}`}
                          className="text-sm font-medium text-content hover:text-primary dark:text-content-dark"
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
                        {new Date(row.updated_at).toLocaleDateString('en-GB')}
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

          <Callout tone="warning" title="The connector table is placeholder">
            <p>
              No table holds a connection, a sync attempt or a failure, so every connector
              above. Its organisations, success rate, last sync and failure count, comes
              from <code>src/lib/adminOverviewDemo.ts</code>. Logs, Retry and Disable are
              disabled rather than wired, because there is nothing to read, retry or
              switch off.
            </p>
            <p>
              Real on this screen: the platform services read from build configuration,
              and the tenant SMTP settings, which are rows customers created. The nearest
              real connector is the CSV payroll export a manager runs from Reports, a
              download rather than a connection, so there is nothing to monitor.
            </p>
          </Callout>
        </div>
      )}
    </AdminPage>
  );
}
