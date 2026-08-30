import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Info } from 'lucide-react';
import { Panel } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
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
  countOptOuts,
  listAnnouncements,
  type AnnouncementRow,
} from '@/services/platformAnnouncementService';
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
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [optOuts, setOptOuts] = useState(0);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setRows(null);
    void (async () => {
      try {
        const [notifications, orgs, devices, announcementRows, optOutCount] =
          await Promise.all([
            listRecentNotifications(WINDOW),
            listAllOrganisations(),
            countPushSubscriptions(),
            listAnnouncements(),
            countOptOuts(),
          ]);
        if (!active) return;
        setRows(notifications);
        setOrganisations(orgs);
        setPushDevices(devices);
        setAnnouncements(announcementRows);
        setOptOuts(optOutCount);
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

  /**
   * What the announcement register adds up to.
   *
   * Deliveries are counted from rows rather than a column on the announcement:
   * a counter drifts the first time a fan-out half fails, and cannot answer
   * "which organisations have not seen it", which is the question that follows
   * the number.
   */
  const announceStats = useMemo(() => {
    const scheduled = announcements.filter((a) => a.status === 'scheduled');
    const next = scheduled
      .map((a) => a.scheduled_for)
      .filter((v): v is string => v !== null)
      .sort()[0];
    return {
      sent: announcements.filter((a) => a.status === 'sent').length,
      drafts: announcements.filter((a) => a.status === 'draft').length,
      scheduled: scheduled.length,
      nextScheduled: next
        ? new Date(next).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : null,
      recipients: announcements.reduce((t, a) => t + a.recipients, 0),
      failed: announcements.reduce((t, a) => t + a.failed, 0),
    };
  }, [announcements]);

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
              label="Announcements sent"
              value={announceStats.sent}
              hint="Published to at least one tenant"
            />
            <StatTile
              label="Deliveries"
              value={announceStats.recipients.toLocaleString('en-GB')}
              hint="One row per recipient organisation"
            />
            {/* No read rate. `mark_announcement_read` exists and nothing in the
                tenant app calls it, so a percentage here could only ever be
                what the seed wrote. It comes back with the banner that sets
                it. */}
            <StatTile
              label="Failed"
              value={announceStats.failed}
              hint={
                announceStats.failed > 0 ? (
                  <span className="font-semibold text-danger-ink dark:text-danger">
                    Provider rejected
                  </span>
                ) : (
                  'Nothing rejected'
                )
              }
            />
            <StatTile
              label="Scheduled"
              value={announceStats.scheduled}
              hint={announceStats.nextScheduled ?? 'Nothing queued'}
            />
            <StatTile
              label="Drafts"
              value={announceStats.drafts}
              hint="Composed, not published"
            />
            <StatTile
              label="Opt-outs"
              value={optOuts}
              hint="Organisations refusing non-essential mail"
            />
          </TileGrid>

          <Panel title="Announcements" flush>
            {/* This table scrolls horizontally and has no focusable child, so
                without `tabIndex` its off-screen columns cannot be reached
                without a mouse (axe `scrollable-region-focusable`, WCAG 2.1.1).
                jsx-a11y objects to tabIndex on a non-interactive element; the
                two rules genuinely disagree and axe is the one that is right
                here, so its rule is disabled for this element only. */}
            <div
              className="overflow-x-auto"
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
              tabIndex={0}
              role="region"
              aria-label="Platform announcements, scrollable"
            >
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
                      ['Recipients', 'right'],
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
                  {announcements.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark"
                      >
                        No announcement has been composed.
                      </td>
                    </tr>
                  ) : (
                    announcements.map((item) => (
                      <tr
                        key={item.id}
                        className="border-b border-divider last:border-0 dark:border-divider-dark"
                      >
                        <td className="px-3 py-2.5 pl-4 font-medium text-content dark:text-content-dark">
                          {item.title}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone="neutral">
                            {item.kind.charAt(0).toUpperCase() + item.kind.slice(1)}
                          </Badge>
                        </td>
                        <td className="truncate px-3 py-2.5 text-content dark:text-content-dark">
                          {item.audience === 'all'
                            ? 'All organisations'
                            : item.audience_plans.join(', ')}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-content-muted dark:text-content-muted-dark">
                          {item.sent_at
                            ? `Sent ${new Date(item.sent_at).toLocaleDateString('en-GB')}`
                            : item.scheduled_for
                              ? `Scheduled ${new Date(item.scheduled_for).toLocaleDateString('en-GB')}`
                              : 'Draft'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-content dark:text-content-dark">
                          {item.sent === 0 ? '-' : item.sent.toLocaleString('en-GB')}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-content dark:text-content-dark">
                          {item.recipients === 0
                            ? '-'
                            : item.recipients.toLocaleString('en-GB')}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge
                            tone={
                              item.status === 'sent'
                                ? 'success'
                                : item.status === 'scheduled'
                                  ? 'warning'
                                  : 'neutral'
                            }
                            dot
                          >
                            {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Callout tone="info" title="What these two records are">
            <p>
              The register above is <code>platform_announcements</code>, and its
              recipients are rows in <code>platform_announcement_deliveries</code>, one
              per organisation. Publishing resolves the audience into those rows, so
              &ldquo;sent to 96 organisations&rdquo; is a count the database made rather
              than one this screen guessed.
            </p>
            <p>
              There is no read rate, because nothing marks one read.{' '}
              <code>mark_announcement_read</code> exists and the tenant app never calls
              it, so a percentage could only repeat what the seed wrote. It comes back
              with the in-app banner that would set it. Delivery below is a different
              record: <code>notifications</code>, addressed to one person inside one
              organisation, written by Edge Functions holding the service role.
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
            {/* Inherits `text-content` from Callout. Muted grey is 4.34 : 1
                on the warning wash (GAP-030). */}
            <p className="text-sm leading-relaxed">
              The only engagement signal in the schema is <code>read_at</code>. There is
              no sent, delivered, bounced or failed column, so an unread notification may
              have arrived perfectly and simply not been opened. Read that percentage as
              attention, not as delivery, and for whether the mail path itself works, see{' '}
              <Link
                to="/admin/integrations"
                className="text-primary-ink underline underline-offset-2 dark:text-primary"
              >
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
