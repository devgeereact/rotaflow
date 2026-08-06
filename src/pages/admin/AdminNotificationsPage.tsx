import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Info } from 'lucide-react';
import { Panel } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Sparkline } from '@/components/ui/TrendChart';
import { MeterRows } from '@/components/ui/MeterRows';
import { Callout } from '@/components/ui/Callout';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import {
  countPushSubscriptions,
  listRecentNotifications,
} from '@/services/platformNotificationsService';
import { listAllOrganisations } from '@/services/platformService';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import {
  NOTIFICATION_GAPS,
  summariseNotifications,
  type NotificationRow,
} from '@/lib/platformNotifications';
import { humaniseKey } from '@/lib/platformOverview';
import {
  DEMO_ANNOUNCEMENTS,
  DEMO_DELIVERED,
  DEMO_NOTIFICATIONS_FAILED,
  DEMO_NOTIFICATIONS_FAILED_HINT,
  DEMO_OPT_OUTS,
  DEMO_READ_RATE,
  DEMO_READ_TREND,
  DEMO_SCHEDULED,
  DEMO_SCHEDULED_HINT,
  DEMO_SENT_30_DAYS,
} from '@/lib/adminOverviewDemo';
import { reportError } from '@/lib/sentry';
import type { Organisation } from '@/types';

/** How many recent rows the summary is drawn from. */
const WINDOW = 1000;

/**
 * `/admin/notifications`. What the platform has actually delivered.
 *
 * ## Why there is no composer here
 *
 * The console reference opens this screen with "New announcement": a title, an
 * audience, a schedule, and delivery statistics afterwards. None of it can be
 * built on this schema. `notifications` rows are addressed to one user inside
 * one organisation; there is no platform-wide message, no audience definition
 * and no fan-out. The table also has **no client insert policy** by design,
 * rows are written by Edge Functions holding the service role, so a compose
 * form in a static console would have nowhere to post.
 *
 * What is real is the delivery record, cross-tenant, because
 * `notifications_select` names `is_platform_admin()` directly. That answers the
 * question this screen is actually opened for: is anything reaching people, on
 * which channel, and are they reading it.
 *
 * ## The one word this screen refuses to use
 *
 * "Delivered". The schema records `read_at` and nothing else, no sent, no
 * bounced, no failed. An unread notification may have arrived perfectly and
 * simply not been opened, so calling the read share a delivery rate would
 * invent a measurement out of an absence.
 */
export function AdminNotificationsPage(): JSX.Element {
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [pushDevices, setPushDevices] = useState(0);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setRows(null);
    void (async () => {
      try {
        const [notifications, orgs, devices] = await Promise.all([
          listRecentNotifications(WINDOW),
          listAllOrganisations(),
          countPushSubscriptions(),
        ]);
        if (!active) return;
        setRows(notifications);
        setOrganisations(orgs);
        setPushDevices(devices);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:notifications' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  const summary = useMemo(
    () => (rows ? summariseNotifications(rows, new Date()) : null),
    [rows],
  );

  return (
    <AdminPage
      title="Platform notifications"
      description="Announcements sent to tenants. Maintenance, incidents, billing and releases."
      action={
        <Button disabled title="There is no announcement table to write to">
          New announcement
        </Button>
      }
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !rows || !summary ? (
        <AdminLoading variant="tiles" rows={4} />
      ) : (
        <div className="space-y-4">
          <TileGrid>
            <StatTile
              label="Sent, 30 days"
              value={DEMO_SENT_30_DAYS.toLocaleString('en-GB')}
            />
            <StatTile label="Delivered" value={DEMO_DELIVERED} />
            <StatTile
              label="Read"
              value={DEMO_READ_RATE}
              chart={<Sparkline values={DEMO_READ_TREND} colour="#1EA06B" />}
            />
            <StatTile
              label="Failed"
              value={DEMO_NOTIFICATIONS_FAILED}
              hint={
                <span className="font-semibold text-danger">
                  {DEMO_NOTIFICATIONS_FAILED_HINT}
                </span>
              }
            />
            <StatTile
              label="Scheduled"
              value={DEMO_SCHEDULED}
              hint={DEMO_SCHEDULED_HINT}
            />
            <StatTile label="Opt-outs" value={DEMO_OPT_OUTS} />
          </TileGrid>

          <Panel title="Announcements" flush>
            <div className="overflow-x-auto">
              <table className="w-full table-fixed border-collapse text-sm">
                <caption className="sr-only">Platform announcements</caption>
                <colgroup>
                  {[
                    'w-[34%]',
                    'w-[13%]',
                    'w-[14%]',
                    'w-[17%]',
                    'w-[7%]',
                    'w-[7%]',
                    'w-[8%]',
                  ].map((w) => (
                    <col key={w} className={w} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="border-b border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
                    {[
                      ['Announcement', 'left'],
                      ['Type', 'left'],
                      ['Audience', 'left'],
                      ['When', 'left'],
                      ['Sent', 'right'],
                      ['Read', 'right'],
                      ['Status', 'left'],
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
                  {DEMO_ANNOUNCEMENTS.map((item) => (
                    <tr
                      key={item.title}
                      className="border-b border-divider last:border-0 dark:border-divider-dark"
                    >
                      <td className="px-3 py-2.5 pl-4 font-medium text-content dark:text-content-dark">
                        {item.title}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone="neutral">{item.type}</Badge>
                      </td>
                      <td className="truncate px-3 py-2.5 text-content dark:text-content-dark">
                        {item.audience}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-content-muted dark:text-content-muted-dark">
                        {item.when}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-content dark:text-content-dark">
                        {item.sent === null ? '-' : item.sent.toLocaleString('en-GB')}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-content dark:text-content-dark">
                        {item.read === null ? '-' : item.read.toLocaleString('en-GB')}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          tone={item.status === 'complete' ? 'success' : 'warning'}
                          dot
                        >
                          {item.status === 'complete' ? 'Complete' : 'Pending'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Callout tone="warning" title="The announcement register is placeholder">
            <p>
              <code>notifications</code> rows are addressed to one user inside one
              organisation, and the table has no client insert policy by design. Rows are
              written by Edge Functions holding the service role. There is no
              platform-wide message, no audience definition, no fan-out and no schedule,
              so the register above and its six figures come from{' '}
              <code>src/lib/adminOverviewDemo.ts</code>, and New announcement is disabled.
            </p>
            <p>
              What is real is the delivery record below: it is readable across every
              tenant because <code>notifications_select</code> names{' '}
              <code>is_platform_admin()</code> directly.
            </p>
          </Callout>

          <Panel title="Actual delivery. Real">
            <dl className="grid gap-4 sm:grid-cols-4">
              {[
                ['Notifications recorded', summary.total.toLocaleString('en-GB')],
                ['Last 7 days', summary.recent.toLocaleString('en-GB')],
                [
                  'Organisations reached',
                  `${summary.organisations} of ${organisations.length}`,
                ],
                ['Push devices registered', pushDevices.toLocaleString('en-GB')],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium text-content-muted dark:text-content-muted-dark">
                    {label}
                  </dt>
                  <dd className="mt-0.5 font-display text-lg font-semibold tabular-nums text-content dark:text-content-dark">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="By channel">
              {summary.byChannel.length === 0 ? (
                <p className="text-sm text-content-muted dark:text-content-muted-dark">
                  Nothing has been sent on this deployment.
                </p>
              ) : (
                <MeterRows
                  caption="Notifications by channel"
                  rows={summary.byChannel.map((c) => ({
                    label: humaniseKey(c.label),
                    value: c.value,
                  }))}
                />
              )}
            </Panel>

            <Panel title="By type">
              {summary.byType.length === 0 ? (
                <p className="text-sm text-content-muted dark:text-content-muted-dark">
                  Nothing has been sent on this deployment.
                </p>
              ) : (
                <MeterRows
                  caption="Notifications by type"
                  rows={summary.byType.slice(0, 8).map((t) => ({
                    label: humaniseKey(t.label),
                    value: t.value,
                    colour: '#388FD4',
                  }))}
                />
              )}
            </Panel>
          </div>

          <Callout tone="warning" title="“Opened” is not a delivery rate">
            <p className="text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
              The only engagement signal in the schema is <code>read_at</code>. There is
              no sent, delivered, bounced or failed column, so an unread notification may
              have arrived perfectly and simply not been opened. Read that percentage as
              attention, not as delivery, and for whether the mail path itself works, see{' '}
              <Link to="/admin/integrations" className="text-primary hover:underline">
                Integrations
              </Link>
              .
            </p>
          </Callout>

          <Panel title="Why there is no composer">
            <ul className="grid gap-3 sm:grid-cols-2">
              {NOTIFICATION_GAPS.map((gap) => (
                <li key={gap.title} className="flex gap-2.5">
                  <Info
                    size={15}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-content-muted dark:text-content-muted-dark"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-content dark:text-content-dark">
                      {gap.title}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
                      {gap.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </AdminPage>
  );
}
