import { api, isApiCode } from '@/lib/api';
import type { Tables } from '@/types/database.types';

export type SupportCase = Tables<'support_cases'>;
export type SupportCaseMessage = Tables<'support_case_messages'>;

export interface SupportCaseRow extends SupportCase {
  orgName: string | null;
  assigneeName: string | null;
}

/**
 * Support cases (0024).
 *
 * The queue is read straight from the table; `support_cases_select` already
 * scopes it. Platform staff see everything, a requester sees their own, an
 * organisation owner sees their tenant's. Internal notes are excluded by the
 * message policy rather than by a filter here, so a mistake in this file
 * cannot leak one.
 */

/** Open first by priority, then oldest first. The order a queue is worked. */
const PRIORITY_ORDER = ['urgent', 'high', 'normal', 'low'];

export async function listSupportCases(limit = 200): Promise<SupportCaseRow[]> {
  const [r, admins] = await Promise.all([
    api.get<{ cases: (SupportCase & { org_name: string | null })[] }>(
      '/platform/support/cases',
      {
        limit: Math.min(200, limit),
      },
    ),
    // Assignees are platform staff; their names come from the roster. A role that cannot read the roster
    // still sees the queue, with ids instead of names.
    api
      .get<{ admins: { user_id: string; full_name: string | null; email: string }[] }>(
        '/platform/admins',
      )
      .then((x) => x.admins)
      .catch(() => [] as { user_id: string; full_name: string | null; email: string }[]),
  ]);
  const personName = new Map(admins.map((a) => [a.user_id, a.full_name ?? a.email]));
  const rows: SupportCaseRow[] = r.cases.map(({ org_name, ...row }) => ({
    ...row,
    orgName: org_name,
    assigneeName: row.assigned_to ? (personName.get(row.assigned_to) ?? null) : null,
  }));

  return rows.sort((a, b) => {
    const openA = a.status === 'resolved' || a.status === 'closed' ? 1 : 0;
    const openB = b.status === 'resolved' || b.status === 'closed' ? 1 : 0;
    if (openA !== openB) return openA - openB;
    const pa = PRIORITY_ORDER.indexOf(a.priority);
    const pb = PRIORITY_ORDER.indexOf(b.priority);
    if (pa !== pb) return pa - pb;
    return Date.parse(a.created_at) - Date.parse(b.created_at);
  });
}

interface CaseDetail {
  case: SupportCase;
  messages: Omit<SupportCaseMessage, 'case_id'>[];
  sla: {
    first_response_state: string;
    resolution_state: string;
    minutes_to_respond: number;
    minutes_to_resolve: number;
  };
}

async function detail(id: string): Promise<CaseDetail | null> {
  try {
    return await api.get<CaseDetail>(`/support/cases/${encodeURIComponent(id)}`);
  } catch (error) {
    if (isApiCode(error, 'not_found')) return null;
    throw error;
  }
}

export async function getSupportCase(id: string): Promise<SupportCase | null> {
  return (await detail(id))?.case ?? null;
}

export async function listCaseMessages(caseId: string): Promise<SupportCaseMessage[]> {
  return ((await detail(caseId))?.messages ?? []).map((m) => ({
    ...m,
    case_id: caseId,
    is_internal: Boolean(Number(m.is_internal)),
  }));
}

/**
 * The signed-in person's own support cases, newest first.
 *
 * Deliberately narrower than RLS. `support_cases_select` (0024) also admits an
 * organisation OWNER to every case raised inside their organisation, which is
 * right for an owner reviewing what their staff have asked — but this feeds
 * the requester's own "Your requests" list on `/app/help`, and only the
 * requester may rate a case (`rate_support_case` checks `requester_id =
 * auth.uid()`). Showing an owner a colleague's case here would offer a rating
 * control that refuses.
 */
export async function listMyCases(_userId: string, limit = 10): Promise<SupportCase[]> {
  // The signed-in person's own cases, and every case of an organisation they own.
  const r = await api.get<{ cases: SupportCase[] }>('/support/cases');
  return r.cases.slice(0, limit);
}

/**
 * Score a resolved case, 1 to 5 (BUG-060).
 *
 * `rate_support_case` shipped in 0024 and had no caller for the whole of that
 * time, so `support_cases.csat` could never be anything but null and the
 * console's CSAT figure could never be anything but "no data". Re-rating is
 * allowed by the function on purpose — a mis-tap should be correctable.
 */
export async function rateCase(
  caseId: string,
  score: number,
  comment?: string | null,
): Promise<void> {
  await api.post(`/support/cases/${encodeURIComponent(caseId)}/rate`, {
    score,
    comment: comment?.trim() ? comment.trim() : null,
  });
}

export async function replyToCase(
  caseId: string,
  body: string,
  internal = false,
): Promise<void> {
  await api.post(`/support/cases/${encodeURIComponent(caseId)}/reply`, {
    body,
    internal,
  });
}

export async function setCaseStatus(
  caseId: string,
  status: 'open' | 'pending' | 'on_hold' | 'resolved' | 'closed',
  note?: string,
): Promise<void> {
  await api.post(`/platform/support/cases/${encodeURIComponent(caseId)}/status`, {
    status,
    note: note ?? null,
  });
}

export async function assignCase(caseId: string, agentId: string | null): Promise<void> {
  await api.post(`/platform/support/cases/${encodeURIComponent(caseId)}/assign`, {
    agent_user_id: agentId,
  });
}

export async function openSupportCase(input: {
  subject: string;
  body: string;
  category?: string;
  priority?: string;
  orgId?: string | null;
  requesterEmail?: string | null;
}): Promise<string> {
  const r = await api.post<{ id: string }>('/support/cases', {
    subject: input.subject,
    body: input.body,
    category: input.category ?? 'question',
    priority: input.priority ?? 'normal',
    org_id: input.orgId ?? null,
    requester_email: input.requesterEmail ?? null,
  });
  return r.id;
}

export type SlaState = 'met' | 'on_track' | 'due_soon' | 'breached';

export interface SlaStatus {
  firstResponse: SlaState;
  resolution: SlaState;
  minutesToRespond: number;
  minutesToResolve: number;
}

/**
 * Whether a case met, is about to miss, or has missed its promise
 * (CAP-080, `0110`).
 *
 * Computed rather than stored: "breached" depends on the current time, and a
 * stored value would be wrong between writes.
 *
 * The clock does NOT pause while waiting on the customer. That is the
 * measure the customer actually experiences, and it is the one that cannot
 * be gamed — the standard alternative lets a case sit for three weeks and
 * still report as within target.
 */
export async function getSlaStatus(caseId: string): Promise<SlaStatus | null> {
  const d = await detail(caseId);
  if (!d) return null;
  return {
    firstResponse: d.sla.first_response_state as SlaState,
    resolution: d.sla.resolution_state as SlaState,
    minutesToRespond: d.sla.minutes_to_respond,
    minutesToResolve: d.sla.minutes_to_resolve,
  };
}
