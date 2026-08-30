import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, Panel } from '@/components/ui/Card';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import {
  assignCase,
  getSupportCase,
  listCaseMessages,
  replyToCase,
  setCaseStatus,
  type SupportCase,
  type SupportCaseMessage,
} from '@/services/supportCaseService';
import { listAllOrganisations, listAllProfiles } from '@/services/platformService';
import { listPlatformAdmins } from '@/services/platformRoleService';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/useToast';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { reportError } from '@/lib/sentry';

type CaseStatus = 'open' | 'pending' | 'on_hold' | 'resolved' | 'closed';

const STATUS_TONE: Record<CaseStatus, BadgeTone> = {
  open: 'warning',
  pending: 'info',
  on_hold: 'neutral',
  resolved: 'success',
  closed: 'neutral',
};

const STATUS_LABEL: Record<CaseStatus, string> = {
  open: 'Open',
  pending: 'Pending',
  on_hold: 'On hold',
  resolved: 'Resolved',
  closed: 'Closed',
};

const PRIORITY_TONE: Record<string, BadgeTone> = {
  urgent: 'danger',
  high: 'warning',
  normal: 'info',
  low: 'neutral',
};

interface Agent {
  id: string;
  name: string;
}

interface Detail {
  case: SupportCase;
  orgName: string | null;
  messages: SupportCaseMessage[];
  agents: Agent[];
}

/**
 * `/admin/support/:caseId`. `replyToCase`, `setCaseStatus` and `assignCase`
 * (0024_support_cases.sql) have existed since the migration shipped, with
 * nothing in the console calling them: a case could be seen and never touched.
 *
 * ## Who can do what here
 *
 * Any platform administrator can read a case, including its internal notes,
 * and reply, `reply_to_support_case` only requires `is_platform_admin()`, and
 * `support_case_messages_select` grants a platform admin every row regardless
 * of role. Moving the status along or reassigning it is narrower,
 * `set_support_case_status` and `assign_support_case` both require owner,
 * admin or support (`PLATFORM_SUPPORT_ROLES`), the same billing carve-out as
 * the rest of the console. The two controls are disabled rather than hidden
 * for a finance-only administrator, so the boundary is visible rather than a
 * silently vanished button.
 */
export function AdminSupportCaseDetailPage(): JSX.Element {
  const { caseId = '' } = useParams();
  const { canManageSupportCases } = usePermissions();
  const { showError, showSuccess } = useToast();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [replyBody, setReplyBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [posting, setPosting] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setFailed(false);
    setNotFound(false);
    try {
      const found = await getSupportCase(caseId);
      if (!found) {
        setNotFound(true);
        return;
      }
      const [messages, orgs, admins, profiles] = await Promise.all([
        listCaseMessages(caseId),
        listAllOrganisations(),
        // Neither list is essential to reading the case itself: a case
        // without an assignable roster is still a case worth showing.
        listPlatformAdmins().catch((err: unknown) => {
          reportError(err, { area: 'admin:support-case:agents' });
          return [];
        }),
        listAllProfiles().catch((err: unknown) => {
          reportError(err, { area: 'admin:support-case:agents' });
          return [];
        }),
      ]);
      const nameById = new Map(
        profiles.map((p) => [p.id, p.full_name ?? p.email ?? 'Unnamed account']),
      );
      const agents = admins
        .filter((a) => a.revoked_at === null)
        .map((a) => ({
          id: a.user_id,
          name: nameById.get(a.user_id) ?? 'Unnamed account',
        }));
      setDetail({
        case: found,
        orgName: found.org_id
          ? (orgs.find((o) => o.id === found.org_id)?.name ?? null)
          : null,
        messages,
        agents,
      });
    } catch (err) {
      reportError(err, { area: 'admin:support-case' });
      setFailed(true);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  const submitReply = useCallback(async (): Promise<void> => {
    const body = replyBody.trim();
    if (!body) return;
    setPosting(true);
    try {
      await replyToCase(caseId, body, internal);
      showSuccess(internal ? 'Internal note added.' : 'Reply sent.');
      setReplyBody('');
      setInternal(false);
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not post that reply.');
    } finally {
      setPosting(false);
    }
  }, [caseId, replyBody, internal, load, showError, showSuccess]);

  const changeStatus = useCallback(
    async (status: CaseStatus): Promise<void> => {
      setStatusBusy(true);
      try {
        await setCaseStatus(caseId, status);
        showSuccess(`Case marked ${STATUS_LABEL[status].toLowerCase()}.`);
        await load();
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Could not change that status.');
      } finally {
        setStatusBusy(false);
      }
    },
    [caseId, load, showError, showSuccess],
  );

  const changeAssignee = useCallback(
    async (agentId: string): Promise<void> => {
      setAssignBusy(true);
      try {
        await assignCase(caseId, agentId || null);
        showSuccess(agentId ? 'Case assigned.' : 'Case unassigned.');
        await load();
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Could not reassign that case.');
      } finally {
        setAssignBusy(false);
      }
    },
    [caseId, load, showError, showSuccess],
  );

  if (notFound) {
    return (
      <AdminPage
        title="Case not found"
        description="No support case has that identifier."
      >
        <Card>
          <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
            The case may have been deleted, or the link may be from another deployment.
          </p>
          <Link to="/admin/support">
            <Button variant="secondary">
              <ArrowLeft size={18} aria-hidden="true" />
              Back to the support centre
            </Button>
          </Link>
        </Card>
      </AdminPage>
    );
  }

  if (failed) {
    return (
      <AdminPage
        title="Support case"
        description="One case, its correspondence and state."
      >
        <AdminError onRetry={retry} />
      </AdminPage>
    );
  }

  if (!detail) {
    return (
      <AdminPage
        title="Support case"
        description="One case, its correspondence and state."
      >
        <AdminLoading variant="card" rows={4} />
      </AdminPage>
    );
  }

  const { case: item } = detail;
  const status = item.status as CaseStatus;

  return (
    <AdminPage
      title={item.subject}
      meta={
        <>
          <span className="font-mono text-xs">{item.reference}</span>
          <span aria-hidden="true">·</span>
          <Badge tone={PRIORITY_TONE[item.priority] ?? 'neutral'} dot>
            {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}
          </Badge>
          <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
        </>
      }
    >
      <div className="space-y-5">
        <Link
          to="/admin/support"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-ink hover:underline dark:text-primary-ink-dark"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Support centre
        </Link>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Case" className="lg:col-span-1" bodyClassName="p-4">
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-3 text-sm">
              <dt className="text-content-muted dark:text-content-muted-dark">
                Organisation
              </dt>
              <dd className="font-medium text-content dark:text-content-dark">
                {item.org_id ? (
                  <Link
                    to={`/admin/organisations/${item.org_id}`}
                    className="text-primary-ink hover:underline dark:text-primary-ink-dark"
                  >
                    {detail.orgName ?? 'Unnamed organisation'}
                  </Link>
                ) : (
                  'Not identified'
                )}
              </dd>
              <dt className="text-content-muted dark:text-content-muted-dark">
                Requester
              </dt>
              <dd className="font-medium text-content dark:text-content-dark">
                {item.requester_name ?? item.requester_email}
              </dd>
              <dt className="text-content-muted dark:text-content-muted-dark">
                Category
              </dt>
              <dd className="font-medium capitalize text-content dark:text-content-dark">
                {item.category}
              </dd>
              <dt className="text-content-muted dark:text-content-muted-dark">Opened</dt>
              <dd className="font-medium text-content dark:text-content-dark">
                {new Date(item.created_at).toLocaleString('en-GB')}
              </dd>
              {item.resolved_at && (
                <>
                  <dt className="text-content-muted dark:text-content-muted-dark">
                    Resolved
                  </dt>
                  <dd className="font-medium text-content dark:text-content-dark">
                    {new Date(item.resolved_at).toLocaleString('en-GB')}
                  </dd>
                </>
              )}
              {item.csat && (
                <>
                  <dt className="text-content-muted dark:text-content-muted-dark">
                    CSAT
                  </dt>
                  <dd className="font-medium text-content dark:text-content-dark">
                    {item.csat} / 5
                  </dd>
                </>
              )}
            </dl>

            <div className="mt-5 space-y-4 border-t border-divider pt-4 dark:border-divider-dark">
              <div>
                <Label htmlFor="case-status">Status</Label>
                <Select
                  id="case-status"
                  value={status}
                  disabled={!canManageSupportCases || statusBusy}
                  title={
                    canManageSupportCases
                      ? undefined
                      : 'Only owner, admin or support may change a case status'
                  }
                  onChange={(e) => void changeStatus(e.target.value as CaseStatus)}
                >
                  {(Object.keys(STATUS_LABEL) as CaseStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="case-assignee">Assigned to</Label>
                <Select
                  id="case-assignee"
                  value={item.assigned_to ?? ''}
                  disabled={!canManageSupportCases || assignBusy}
                  title={
                    canManageSupportCases
                      ? undefined
                      : 'Only owner, admin or support may reassign a case'
                  }
                  onChange={(e) => void changeAssignee(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {detail.agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </Panel>

          <Panel title="Correspondence" className="lg:col-span-2" flush>
            <ul className="divide-y divide-divider dark:divide-divider-dark">
              {detail.messages.length === 0 ? (
                <li className="px-4 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
                  No message on this case yet.
                </li>
              ) : (
                detail.messages.map((m) => (
                  <li key={m.id} className="space-y-1.5 px-4 py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-content dark:text-content-dark">
                        {m.author_name ??
                          (m.author_side === 'platform' ? 'Platform' : 'Customer')}
                      </span>
                      <Badge tone={m.author_side === 'platform' ? 'info' : 'neutral'}>
                        {m.author_side === 'platform' ? 'Platform' : 'Customer'}
                      </Badge>
                      {m.is_internal && (
                        <Badge tone="warning" dot>
                          <Lock size={11} aria-hidden="true" className="mr-1 inline" />
                          Internal note
                        </Badge>
                      )}
                      <span className="ml-auto text-xs text-content-muted dark:text-content-muted-dark">
                        {new Date(m.created_at).toLocaleString('en-GB')}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-content dark:text-content-dark">
                      {m.body}
                    </p>
                  </li>
                ))
              )}
            </ul>

            <div className="space-y-2.5 border-t border-divider p-4 dark:border-divider-dark">
              <Label htmlFor="case-reply">
                {internal ? 'Internal note' : 'Reply to the requester'}
              </Label>
              <textarea
                id="case-reply"
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                rows={4}
                placeholder={
                  internal
                    ? 'Visible to platform staff only.'
                    : 'Visible to the requester and, when the case belongs to a tenant, its owner.'
                }
                className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm text-content dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm text-content dark:text-content-dark">
                  <input
                    type="checkbox"
                    checked={internal}
                    onChange={(e) => setInternal(e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  Internal note, not visible to the requester
                </label>
                <Button
                  onClick={() => void submitReply()}
                  disabled={posting || replyBody.trim().length === 0}
                >
                  {posting ? 'Sending…' : internal ? 'Add note' : 'Send reply'}
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </AdminPage>
  );
}
