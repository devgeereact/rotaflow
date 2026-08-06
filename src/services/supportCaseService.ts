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
