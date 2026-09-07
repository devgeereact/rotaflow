import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { MeterRows } from '@/components/ui/MeterRows';
import { Callout } from '@/components/ui/Callout';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import { Pagination } from '@/components/ui/Pagination';
import { FilterBar } from '@/components/ui/FilterBar';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import { AdminAnnouncementComposer } from '@/components/admin/AdminAnnouncementComposer';
import type { AnnouncementComposerResult } from '@/components/admin/AdminAnnouncementComposer';
import {
  countPushSubscriptions,
  listRecentNotifications,
} from '@/services/platformNotificationsService';
import { getOrganisationFacets } from '@/services/platformDirectoryService';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { useFilterState } from '@/hooks/useFilterState';
import { filterValue, filterValues } from '@/lib/filters';
import type { FilterDimension, FilterOption } from '@/lib/filters';
import { type ServerPage } from '@/lib/serverPage';
import {
  summariseNotifications,
  type NotificationRow,
} from '@/lib/platformNotifications';
import { humaniseKey } from '@/lib/platformOverview';
import {
  cancelAnnouncement,
  countOptOuts,
  listAnnouncements,
  publishAnnouncement,
  type AnnouncementRow,
} from '@/services/platformAnnouncementService';
import { reportError } from '@/lib/sentry';

/** How many recent rows the summary is drawn from. */
const WINDOW = 1000;

const ANNOUNCEMENT_FILTERS: readonly FilterDimension[] = [
  { id: 'q', label: 'Search', kind: 'text' },
  { id: 'status', label: 'Status', kind: 'multi' },
  { id: 'kind', label: 'Type', kind: 'multi' },
  { id: 'audience', label: 'Audience', kind: 'select' },
] as const;

/**
 * `sent` is labelled "Published", not "Sent".
 *
 * The column value is `sent` because `0025` named it that, and renaming a
 * CHECK value to fix a word on a screen is the wrong trade. What it means is
 * that the audience has been resolved and a dispatch queued for each
 * organisation — which is publication. Whether a given recipient was reached
 * is the delivery columns' job, and they are four separate numbers for a
 * reason.
 */
const STATUS_OPTIONS: readonly FilterOption[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'sent', label: 'Published' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

const KIND_OPTIONS: readonly FilterOption[] = [
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'incident', label: 'Incident' },
  { value: 'product', label: 'Product' },
  { value: 'billing', label: 'Billing' },
  { value: 'policy', label: 'Policy' },
] as const;

const AUDIENCE_OPTIONS: readonly FilterOption[] = [
  { value: 'all', label: 'Every organisation' },
  { value: 'plans', label: 'Chosen plans' },
] as const;

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sent: 'Published',
  cancelled: 'Cancelled',
};

/**
 * `/admin/notifications`. What the platform has announced, and what has
 * actually reached anybody.
 *
 * ## The composer this screen said could not exist
 *
 * Until 0132 the New announcement button was disabled with the title "There
 * is no announcement table to write to", and a panel below the register
 * listed four reasons a composer was impossible. Every one of them was out of
 * date: `platform_announcements`, an audience definition and a fan-out RPC all
 * shipped in `0025`, and the screen was listing rows from that table while
 * denying it existed. What was genuinely missing was a caller for the service,
 * a job to publish a scheduled one, and a dispatch path — and the dispatch
 * path had existed since `0069`, draining rota publications every minute.
 *
 * ## Queued, delivered, failed and read are four columns
 *
 * `publish_platform_announcement` used to stamp `sent_at` on every delivery
 * row at insert, so the Deliveries tile counted intentions. It queues now, and
 * a delivery becomes sent when the dispatch is confirmed. Read stays at zero
 * and says so: `mark_announcement_read` exists and no tenant screen calls it,
 * so a read rate here could only repeat what a fixture wrote.
 */
export function AdminNotificationsPage(): JSX.Element {
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [orgTotal, setOrgTotal] = useState(0);
  const [pushDevices, setPushDevices] = useState(0);
  const [announcements, setAnnouncements] = useState<ServerPage<AnnouncementRow> | null>(
    null,
  );
  const [optOuts, setOptOuts] = useState(0);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { showError, showSuccess } = useToast();
  const { confirm } = useConfirm();

  const filterApi = useFilterState({
    dimensions: ANNOUNCEMENT_FILTERS,
    scopeKey: 'platform',
  });
  const { filters, page: pageNumber } = filterApi;

  const announcementQuery = useMemo(
    () => ({
      search: filterValue(filters, 'q') || undefined,
      status: filterValues(filters, 'status').length
        ? [...filterValues(filters, 'status')]
        : undefined,
      kind: filterValues(filters, 'kind').length
        ? [...filterValues(filters, 'kind')]
        : undefined,
      audience: filterValues(filters, 'audience').length
        ? [...filterValues(filters, 'audience')]
        : undefined,
      page: pageNumber,
      pageSize: 20,
    }),
    [filters, pageNumber],
  );

  const requestRef = useRef(0);

  useEffect(() => {
    const ticket = ++requestRef.current;
    setFailed(false);
    void (async () => {
      try {
        const [notifications, facets, devices, announcementPage, optOutCount] =
          await Promise.all([
            listRecentNotifications(WINDOW),
            // The estate total, from a server aggregate. This used to be
            // `listAllOrganisations().length`, which is the length of whatever
            // PostgREST returned rather than the number of tenants.
            getOrganisationFacets(),
            countPushSubscriptions(),
            listAnnouncements(announcementQuery),
            countOptOuts(),
          ]);
        if (ticket !== requestRef.current) return;
        setRows(notifications);
        setOrgTotal(facets.total);
        setPushDevices(devices);
        setAnnouncements(announcementPage);
        setOptOuts(optOutCount);
      } catch (err) {
        if (ticket !== requestRef.current) return;
        reportError(err, { area: 'admin:notifications' });
        setFailed(true);
      }
    })();
  }, [announcementQuery, reloadKey]);

  /**
   * What the register on this page adds up to.
   *
   * Scoped to the page, and the tiles say so. These used to be computed over
   * the fifty rows `listAnnouncements()` happened to return and printed as
   * though they described everything ever announced. The estate-wide figure
   * that matters — how many organisations exist — comes from a server
   * aggregate instead.
   */
  const announceStats = useMemo(() => {
    const shown = announcements?.rows ?? [];
    const scheduled = shown.filter((a) => a.status === 'scheduled');
    const next = scheduled
      .map((a) => a.scheduled_for)
      .filter((v): v is string => v !== null)
      .sort()[0];
    return {
      published: shown.filter((a) => a.status === 'sent').length,
      drafts: shown.filter((a) => a.status === 'draft').length,
      scheduled: scheduled.length,
      nextScheduled: next
        ? new Date(next).toLocaleString('en-GB', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })
        : null,
      recipients: shown.reduce((t, a) => t + a.recipients, 0),
      queued: shown.reduce((t, a) => t + a.queued, 0),
      delivered: shown.reduce((t, a) => t + a.delivered, 0),
      failed: shown.reduce((t, a) => t + a.failed, 0),
    };
  }, [announcements]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  const optionsFor = useCallback((dimensionId: string): readonly FilterOption[] => {
    switch (dimensionId) {
      case 'status':
        return STATUS_OPTIONS;
      case 'kind':
        return KIND_OPTIONS;
      case 'audience':
        return AUDIENCE_OPTIONS;
      default:
        return [];
    }
  }, []);

  const handleComposed = useCallback(
    (result: AnnouncementComposerResult) => {
      setComposerOpen(false);
      setReloadKey((k) => k + 1);
      if (result.status === 'sent') {
        // "Queued to", not "delivered to". The dispatch is on the outbox and
        // the register's own columns are what say whether it arrived.
        showSuccess(
          `${result.title} published. Queued to ${(result.queuedTo ?? 0).toLocaleString('en-GB')} ${
            result.queuedTo === 1 ? 'organisation' : 'organisations'
          }.`,
        );
      } else if (result.status === 'scheduled') {
        showSuccess(
          `${result.title} scheduled. It publishes within a minute of that time.`,
        );
      } else {
        showSuccess(`${result.title} saved as a draft. Nothing has been sent.`);
      }
    },
    [showSuccess],
  );

  const handlePublish = useCallback(
    async (row: AnnouncementRow): Promise<void> => {
      const ok = await confirm({
        title: `Publish “${row.title}”?`,
        message:
          'The audience is resolved into a delivery row per organisation and a notification is queued for each one\u2019s owners and managers. It cannot be unsent.',
        confirmLabel: 'Publish',
        tone: 'danger',
      });
      if (!ok) return;

      setBusyId(row.id);
      try {
        const queuedTo = await publishAnnouncement(row.id);
        showSuccess(
          `Queued to ${queuedTo.toLocaleString('en-GB')} ${queuedTo === 1 ? 'organisation' : 'organisations'}.`,
        );
        setReloadKey((k) => k + 1);
      } catch (err) {
        reportError(err, { area: 'admin:announce:publish' });
        showError(
          err instanceof Error && err.message
            ? err.message
            : 'Could not publish that announcement.',
        );
      } finally {
        setBusyId(null);
      }
    },
    [confirm, showError, showSuccess],
  );

  const handleCancel = useCallback(
    async (row: AnnouncementRow): Promise<void> => {
      const ok = await confirm({
        title: `Cancel “${row.title}”?`,
        message:
          'It stays in the register as cancelled. Nothing has been sent, so nobody is told anything.',
        confirmLabel: 'Cancel it',
        tone: 'danger',
      });
      if (!ok) return;

      setBusyId(row.id);
      try {
        await cancelAnnouncement(row.id);
        showSuccess('Announcement cancelled.');
        setReloadKey((k) => k + 1);
      } catch (err) {
        reportError(err, { area: 'admin:announce:cancel' });
        showError(
          err instanceof Error && err.message
            ? err.message
            : 'Could not cancel that announcement.',
        );
      } finally {
        setBusyId(null);
      }
    },
    [confirm, showError, showSuccess],
  );

  const summary = useMemo(
    () => (rows ? summariseNotifications(rows, new Date()) : null),
    [rows],
  );

  return (
    <AdminPage
      title="Platform notifications"
      description="Announcements sent to tenants. Maintenance, incidents, billing and releases."
      action={
        <Button onClick={() => setComposerOpen(true)}>
          <Plus size={15} aria-hidden="true" />
          New announcement
        </Button>
      }
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !rows || !summary || !announcements ? (
        <AdminLoading variant="tiles" rows={4} />
      ) : (
        <div className="space-y-4">
          <TileGrid>
            <StatTile
              label="Published"
              value={announceStats.published}
              hint="On this page of the register"
            />
            <StatTile
              label="Recipients"
              value={announceStats.recipients.toLocaleString('en-GB')}
              hint="One row per addressed organisation"
            />
            {/* Queued and Delivered are separate tiles because they are
                separate facts. `publish_platform_announcement` used to stamp
                `sent_at` at insert, so this screen counted intentions and
                called them deliveries. 0132 queues, and the reconciliation
                that watches the outbox is what moves a row from one column to
                the other. */}
            <StatTile
              label="Queued"
              value={announceStats.queued.toLocaleString('en-GB')}
              hint="Dispatched, not yet confirmed"
            />
            <StatTile
              label="Delivered"
              value={announceStats.delivered.toLocaleString('en-GB')}
              hint="Dispatch confirmed by the outbox"
            />
            {/* No read rate. `mark_announcement_read` exists and nothing in the
                tenant app calls it, so a percentage here could only ever be
                what a fixture wrote. It comes back with the banner that sets
                it. */}
            <StatTile
              label="Failed"
              value={announceStats.failed}
              hint={
                announceStats.failed > 0 ? (
                  <span className="font-semibold text-danger-ink dark:text-danger-ink-dark">
                    Unreachable or rejected
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
            <div className="border-b border-divider p-3 dark:border-divider-dark">
              <FilterBar
                dimensions={ANNOUNCEMENT_FILTERS}
                filters={filters}
                optionsFor={optionsFor}
                onSetValue={filterApi.setValue}
                onSetValues={filterApi.setValues}
                onClearOne={filterApi.clearOne}
                onClearAll={filterApi.clearAll}
                searchPlaceholder="Search title or message"
                resultSummary={
                  announcements.total === 0
                    ? 'None'
                    : `${announcements.from.toLocaleString('en-GB')}–${announcements.to.toLocaleString('en-GB')} of ${announcements.total.toLocaleString('en-GB')}`
                }
              />
            </div>

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
              <table className="w-full min-w-[68rem] table-fixed border-collapse text-sm">
                <caption className="sr-only">Platform announcements</caption>
                <colgroup>
                  {[
                    'w-[22%]',
                    'w-[9%]',
                    'w-[12%]',
                    'w-[14%]',
                    'w-[6%]',
                    'w-[8%]',
                    'w-[6%]',
                    'w-[10%]',
                    'w-[13%]',
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
                      ['Queued', 'right'],
                      ['Delivered', 'right'],
                      ['Failed', 'right'],
                      ['Status', 'left'],
                      ['Actions', 'right'],
                    ].map(([heading, align]) => (
                      <th
                        key={heading}
                        className={`whitespace-nowrap px-3 py-2.5 text-[0.69rem] font-semibold uppercase tracking-[0.06em] text-content-muted first:pl-4 dark:text-content-muted-dark ${
                          align === 'right' ? 'text-right' : 'text-left'
                        }`}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {announcements.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-4 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark"
                      >
                        {announcements.total === 0
                          ? 'No announcement has been composed.'
                          : 'No announcement matches these filters.'}
                      </td>
                    </tr>
                  ) : (
                    announcements.rows.map((item) => (
                      <tr
                        key={item.id}
                        className="border-b border-divider last:border-0 dark:border-divider-dark"
                      >
                        <td className="px-3 py-2.5 pl-4">
                          <span className="block truncate font-medium text-content dark:text-content-dark">
                            {item.title}
                          </span>
                          <span className="block truncate text-xs text-content-muted dark:text-content-muted-dark">
                            {item.body}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone="neutral">{humaniseKey(item.kind)}</Badge>
                        </td>
                        <td className="truncate px-3 py-2.5 text-content dark:text-content-dark">
                          {item.audience === 'all'
                            ? 'All organisations'
                            : item.audience_plans.map(humaniseKey).join(', ')}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-content-muted dark:text-content-muted-dark">
                          {item.sent_at
                            ? `Published ${new Date(item.sent_at).toLocaleDateString('en-GB')}`
                            : item.scheduled_for
                              ? `Scheduled ${new Date(item.scheduled_for).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                              : 'Not scheduled'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-content dark:text-content-dark">
                          {item.queued === 0 ? '-' : item.queued.toLocaleString('en-GB')}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-content dark:text-content-dark">
                          {item.delivered === 0
                            ? '-'
                            : item.delivered.toLocaleString('en-GB')}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                            item.failed > 0
                              ? 'text-danger-ink dark:text-danger-ink-dark'
                              : 'text-content dark:text-content-dark'
                          }`}
                        >
                          {item.failed === 0 ? '-' : item.failed.toLocaleString('en-GB')}
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
                            {STATUS_LABEL[item.status] ?? humaniseKey(item.status)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {/* A published announcement has no action. It cannot
                              be unsent, and offering a button that would be
                              refused is the decorative-control problem this
                              screen was repaired for. */}
                          {item.status === 'draft' || item.status === 'scheduled' ? (
                            <span className="flex justify-end gap-1.5">
                              <button
                                type="button"
                                disabled={busyId === item.id}
                                onClick={() => void handlePublish(item)}
                                className="rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-content hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                              >
                                Publish
                              </button>
                              <button
                                type="button"
                                disabled={busyId === item.id}
                                onClick={() => void handleCancel(item)}
                                className="rounded-lg border border-danger/34 px-2 py-1 text-xs font-medium text-danger-ink hover:bg-danger-wash disabled:cursor-not-allowed disabled:opacity-50 dark:text-danger-ink-dark dark:hover:bg-danger-wash-dark"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <span className="text-xs text-content-muted dark:text-content-muted-dark">
                              -
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              page={announcements.page}
              pageCount={announcements.pageCount}
              total={announcements.total}
              from={announcements.from}
              to={announcements.to}
              onPageChange={filterApi.setPage}
              noun="announcements"
            />
          </Panel>

          <Callout tone="info" title="What these two records are">
            <p>
              The register above is <code>platform_announcements</code>, and its
              recipients are rows in <code>platform_announcement_deliveries</code>, one
              per organisation. Publishing resolves the audience into those rows and
              queues one dispatch per organisation on <code>notification_outbox</code> —
              the same queue that has carried rota publications since 0069 — so Queued and
              Delivered are two different numbers and neither is guessed from the other.
            </p>
            <p>
              There is no read rate, because nothing marks one read.{' '}
              <code>mark_announcement_read</code> exists and the tenant app never calls
              it, so a percentage could only repeat what a fixture wrote. It comes back
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
                ['Organisations reached', `${summary.organisations} of ${orgTotal}`],
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
                className="text-primary-ink underline underline-offset-2 dark:text-primary-ink-dark"
              >
                Integrations
              </Link>
              .
            </p>
          </Callout>
        </div>
      )}

      <AdminAnnouncementComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onDone={handleComposed}
      />
    </AdminPage>
  );
}
