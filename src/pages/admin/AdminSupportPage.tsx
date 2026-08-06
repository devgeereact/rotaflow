import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ShieldAlert } from 'lucide-react';
import { Card, Panel } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import { listAllOrganisations } from '@/services/platformService';
import { listSupportAccessSessions } from '@/services/supportAccessService';
import {
  formatRemaining,
  millisecondsRemaining,
  sessionStatus,
  SCOPE_LABELS,
  type SupportAccessSession,
} from '@/lib/supportAccess';
import { listSupportCases, type SupportCaseRow } from '@/services/supportCaseService';
import {
  averageCsat,
  awaitingFirstResponse,
  csatResponses,
  formatMinutes,
  medianFirstResponseMinutes,
  medianResolutionMinutes,
  openCases,
  urgentOpenCases,
} from '@/lib/supportMetrics';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { reportError } from '@/lib/sentry';
import type { Organisation } from '@/types';

const PRIORITY_TONE: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  urgent: 'danger',
  high: 'warning',
  normal: 'info',
  low: 'neutral',
};

const STATUS_TONE: Record<string, 'warning' | 'info' | 'success' | 'neutral'> = {
  open: 'warning',
  pending: 'info',
  on_hold: 'neutral',
  resolved: 'success',
  closed: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  pending: 'Pending',
  on_hold: 'On hold',
  resolved: 'Resolved',
  closed: 'Closed',
};

const COLUMNS = [
  'Case',
  'Priority',
  'Subject',
  'Organisation',
  'Requester',
  'Assigned',
  'Status',
  'Updated',
] as const;

const WIDTHS = [
  'w-[8%]',
  'w-[9%]',
  'w-[22%]',
  'w-[15%]',
  'w-[11%]',
  'w-[11%]',
  'w-[12%]',
  'w-[12%]',
] as const;

/**
 * `/admin/support`. The support desk, built to the shape of
 * `docs/PLATFORM_CONSOLE.html`.
 *
 * ## The case queue is placeholder; the access log beside it is not
 *
 * There is no `support_cases` table and no inbound channel writing to one, so
 * every case, priority, assignment, response target and satisfaction score on
 * this screen comes from `src/lib/adminOverviewDemo.ts`. What *is* real sits at
 * the top and on `/admin/support-access`: who is inside a customer's data right
 * now, under what reason, for how much longer.
 *
 * That distinction is on the screen rather than in this comment, because "we
 * have support cases" is a sentence someone repeats to a customer.
 *
 * ## What this screen used to claim, and why it was wrong
 *
 * It said time-boxed support access "is not built" and that
 * `support_access_sessions` "exists in no migration". Both were true when it was
 * written and both stopped being true at 0019, which created the table, added
 * `request_support_access` and made the customer's opt-out a database-enforced
 * precondition.
 */
export function AdminSupportPage(): JSX.Element {
  const [organisations, setOrganisations] = useState<Organisation[] | null>(null);
  const [sessions, setSessions] = useState<SupportAccessSession[]>([]);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [allCases, setAllCases] = useState<SupportCaseRow[]>([]);

  // One clock per render pass so every countdown on the screen agrees.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setOrganisations(null);
    void (async () => {
      try {
        const [orgs, rows, caseRows] = await Promise.all([
          listAllOrganisations(),
          listSupportAccessSessions(100),
          listSupportCases(),
        ]);
        if (!active) return;
        setOrganisations(orgs);
        setSessions(rows);
        setAllCases(caseRows);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:support' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  const orgByName = useMemo(
    () => new Map((organisations ?? []).map((o) => [o.name, o])),
    [organisations],
  );

  const open = useMemo(
    () => sessions.filter((s) => sessionStatus(s, now) === 'active'),
    [sessions, now],
  );

  const cases = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allCases.filter((item) => {
      if (status && item.status !== status) return false;
      if (priority && item.priority !== priority) return false;
      if (!q) return true;
      return (
        item.reference.toLowerCase().includes(q) ||
        item.subject.toLowerCase().includes(q) ||
        (item.orgName ?? '').toLowerCase().includes(q) ||
        (item.requester_name ?? item.requester_email).toLowerCase().includes(q)
      );
    });
  }, [allCases, search, status, priority]);

  // Every figure below is derived from the rows, so the tiles and the table
  // cannot disagree, and each reads "-" rather than zero when there is
  // nothing to measure.
  const counts = useMemo(
    () => ({
      open: openCases(allCases),
      urgent: urgentOpenCases(allCases),
      awaiting: awaitingFirstResponse(allCases),
      firstResponse: medianFirstResponseMinutes(allCases),
      resolution: medianResolutionMinutes(allCases),
      csat: averageCsat(allCases),
      csatCount: csatResponses(allCases),
    }),
    [allCases],
  );

  return (
    <AdminPage
      title="Support centre"
      description="Customer cases, response targets and the support access they justify."
      action={
        <>
          <Link to="/admin/support-access">
            <Button variant="secondary">Support access</Button>
          </Link>
          <Button
            disabled
            title="Cases arrive from customers; opening one on their behalf is not built yet"
          >
            <Plus size={15} aria-hidden="true" />
            New case
          </Button>
        </>
      }
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !organisations ? (
        <AdminLoading variant="tiles" rows={4} />
      ) : (
        <div className="space-y-4">
          <TileGrid>
            <StatTile label="Open cases" value={counts.open} />
            <StatTile
              label="Urgent"
              value={counts.urgent}
              hint={
                counts.urgent > 0 ? (
                  <span className="font-semibold text-danger">Still open</span>
                ) : (
                  'None open'
                )
              }
            />
            <StatTile
              label="Awaiting first reply"
              value={counts.awaiting}
              hint="Open, never answered"
            />
            <StatTile
              label="Median first response"
              value={formatMinutes(counts.firstResponse)}
              hint="Across answered cases"
            />
            <StatTile
              label="Median resolution"
              value={formatMinutes(counts.resolution)}
              hint="Across resolved cases"
            />
            <StatTile
              label="CSAT"
              value={counts.csat === null ? '-' : `${counts.csat} / 5`}
              hint={
                counts.csatCount === 0
                  ? 'Nobody has rated a case'
                  : `${counts.csatCount} response${counts.csatCount === 1 ? '' : 's'}`
              }
            />
          </TileGrid>

          {open.length > 0 && (
            <Panel title="Open right now. Real" flush>
              <ul>
                {open.map((session) => (
                  <li
                    key={session.id}
                    className="flex flex-wrap items-center gap-2 border-b border-divider px-4 py-3 last:border-0 dark:border-divider-dark"
                  >
                    <ShieldAlert
                      size={16}
                      aria-hidden="true"
                      className="shrink-0 text-warning"
                    />
                    <span className="text-sm font-medium text-content dark:text-content-dark">
                      {session.adminName}
                    </span>
                    <span className="text-sm text-content-muted dark:text-content-muted-dark">
                      is viewing
                    </span>
                    <Link
                      to={`/admin/organisations/${session.orgId}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      {session.orgName}
                    </Link>
                    <Badge tone="neutral">{SCOPE_LABELS[session.scope]}</Badge>
                    <Badge tone="neutral">{session.caseRef}</Badge>
                    <span className="ml-auto font-mono text-xs tabular-nums text-warning">
                      {formatRemaining(millisecondsRemaining(session.expiresAt, now))}{' '}
                      left
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Card className="p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-divider p-3 dark:border-divider-dark">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search case, subject, organisation…"
                aria-label="Search cases"
                className="max-w-xs"
              />
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label="Filter by status"
                className="w-auto"
              >
                <option value="">Any status</option>
                <option value="open">Open</option>
                <option value="pending">Pending</option>
                <option value="on_hold">On hold</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </Select>
              <Select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                aria-label="Filter by priority"
                className="w-auto"
              >
                <option value="">Any priority</option>
                {['urgent', 'high', 'normal', 'low'].map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </Select>
              <span className="ml-auto font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
                {cases.length} of {allCases.length}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full table-fixed border-collapse text-sm">
                <caption className="sr-only">Support cases</caption>
                <colgroup>
                  {WIDTHS.map((w) => (
                    <col key={w} className={w} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="border-b border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
                    {COLUMNS.map((heading) => (
                      <th
                        key={heading}
                        className="px-3 py-2.5 text-left text-[0.69rem] font-semibold uppercase tracking-[0.06em] text-content-muted first:pl-4 dark:text-content-muted-dark"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cases.length === 0 ? (
                    <tr>
                      <td
                        colSpan={COLUMNS.length}
                        className="px-4 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark"
                      >
                        No case matches these filters.
                      </td>
                    </tr>
                  ) : (
                    cases.map((item) => {
                      const org = item.orgName ? orgByName.get(item.orgName) : undefined;
                      return (
                        <tr
                          key={item.id}
                          className="border-b border-divider last:border-0 dark:border-divider-dark"
                        >
                          <td className="px-3 py-2.5 pl-4 font-mono text-xs tabular-nums text-content dark:text-content-dark">
                            {item.reference}
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge tone={PRIORITY_TONE[item.priority] ?? 'neutral'} dot>
                              {item.priority.charAt(0).toUpperCase() +
                                item.priority.slice(1)}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="block truncate font-medium text-content dark:text-content-dark">
                              {item.subject}
                            </span>
                            <span className="block truncate text-xs text-content-muted dark:text-content-muted-dark">
                              {item.category}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            {org ? (
                              <Link
                                to={`/admin/organisations/${org.id}`}
                                className="block truncate text-primary hover:underline"
                              >
                                {item.orgName}
                              </Link>
                            ) : (
                              <span className="block truncate text-content dark:text-content-dark">
                                {item.orgName ?? 'Not identified'}
                              </span>
                            )}
                          </td>
                          <td className="truncate px-3 py-2.5 text-content dark:text-content-dark">
                            {item.requester_name ?? item.requester_email}
                          </td>
                          <td className="truncate px-3 py-2.5 text-content dark:text-content-dark">
                            {item.assigneeName ?? 'Unassigned'}
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge tone={STATUS_TONE[item.status] ?? 'neutral'} dot>
                              {STATUS_LABEL[item.status] ?? item.status}
                            </Badge>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-content-muted dark:text-content-muted-dark">
                            {new Date(item.updated_at).toLocaleDateString('en-GB')}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Callout tone="info" title="Where these cases come from">
            <p>
              Every row above is a <code>support_cases</code> row, and the medians are
              computed from the timestamps on them. First response is stamped once, by the
              reply that caused it, so the number cannot drift with how a query defines
              &ldquo;first&rdquo;.
            </p>
            <p>
              What is not built is an inbound channel: nothing turns an email into a case
              yet, so the queue only contains what the app itself created. Support access
              sessions are separate and live on{' '}
              <Link to="/admin/support-access" className="text-primary hover:underline">
                Support Access
              </Link>
              .
            </p>
          </Callout>
        </div>
      )}
    </AdminPage>
  );
}
