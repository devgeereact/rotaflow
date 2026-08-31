import { supabase } from '@/lib/supabase';
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
  // Three plain selects rather than PostgREST embedding: the generated types
  // carry no relationships for these tables, so an embed does not typecheck,
  // and the two lookups are small enough that joining in memory is cheaper
  // than the round trip an embed saves.
  const [cases, orgs, profiles] = await Promise.all([
    supabase
      .from('support_cases')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase.from('organisations').select('id, name'),
    supabase.from('profiles').select('id, full_name'),
  ]);
  if (cases.error) throw cases.error;
  if (orgs.error) throw orgs.error;
  if (profiles.error) throw profiles.error;

  const orgName = new Map((orgs.data ?? []).map((o) => [o.id, o.name]));
  const personName = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name]));

  const rows: SupportCaseRow[] = (cases.data ?? []).map((row) => ({
    ...row,
    orgName: row.org_id ? (orgName.get(row.org_id) ?? null) : null,
    assigneeName: row.assigned_to ? (personName.get(row.assigned_to) ?? null) : null,
  }));

  // Sorted here rather than in SQL: "urgent before high before normal" is not
  // alphabetical, and a CASE expression in an `order` string is the kind of
  // thing that silently stops matching when a priority is added.
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

export async function getSupportCase(id: string): Promise<SupportCase | null> {
  const { data, error } = await supabase
    .from('support_cases')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listCaseMessages(caseId: string): Promise<SupportCaseMessage[]> {
  const { data, error } = await supabase
    .from('support_case_messages')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
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
export async function listMyCases(userId: string, limit = 10): Promise<SupportCase[]> {
  const { data, error } = await supabase
    .from('support_cases')
    .select('*')
    .eq('requester_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
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
  const { error } = await supabase.rpc('rate_support_case', {
    p_case: caseId,
    p_score: score,
    p_comment: comment?.trim() ? comment.trim() : undefined,
  });
  if (error) throw error;
}

export async function replyToCase(
  caseId: string,
  body: string,
  internal = false,
): Promise<void> {
  const { error } = await supabase.rpc('reply_to_support_case', {
    p_case: caseId,
    p_body: body,
    p_internal: internal,
  });
  if (error) throw error;
}

export async function setCaseStatus(
  caseId: string,
  status: 'open' | 'pending' | 'on_hold' | 'resolved' | 'closed',
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc('set_support_case_status', {
    p_case: caseId,
    p_status: status,
    p_note: note ?? undefined,
  });
  if (error) throw error;
}

export async function assignCase(caseId: string, agentId: string | null): Promise<void> {
  const { error } = await supabase.rpc('assign_support_case', {
    p_case: caseId,
    // Unassigning is passing no agent. The function's parameter has no
    // default, so `undefined` sends SQL NULL, which is what clears it.
    p_agent: agentId ?? undefined,
  });
  if (error) throw error;
}

export async function openSupportCase(input: {
  subject: string;
  body: string;
  category?: string;
  priority?: string;
  orgId?: string | null;
  requesterEmail?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('open_support_case', {
    p_subject: input.subject,
    p_body: input.body,
    p_category: input.category ?? 'question',
    p_priority: input.priority ?? 'normal',
    p_org: input.orgId ?? undefined,
    p_requester_email: input.requesterEmail ?? undefined,
  });
  if (error) throw error;
  return data;
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
  const { data, error } = await supabase.rpc('support_sla_state', { p_case: caseId });
  if (error) throw error;

  const row = (data ?? [])[0];
  if (!row) return null;
  return {
    firstResponse: row.first_response_state as SlaState,
    resolution: row.resolution_state as SlaState,
    minutesToRespond: row.minutes_to_respond,
    minutesToResolve: row.minutes_to_resolve,
  };
}
