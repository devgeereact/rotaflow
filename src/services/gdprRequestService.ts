import { supabase } from '@/lib/supabase';
import type { GdprRequest, GdprRequestKind, GdprRequestStatus } from '@/lib/gdprRequests';

/**
 * The data subject request register.
 *
 * Reads are plain queries, `gdpr_requests_select` in 0020 admits platform
 * staff to every row and an organisation's own owner to requests recorded
 * against them, so the same call serves the console and (later) a tenant-side
 * view without a privileged path.
 *
 * Every mutation goes through an RPC that raises. The computed deadline, the
 * outcome-on-close rule and the extension reason are all enforced in the
 * database, so a refused write comes back as an error rather than as a row
 * that quietly did not change.
 */

interface RequestRow {
  id: string;
  org_id: string | null;
  subject_email: string;
  subject_name: string | null;
  kind: string;
  status: string;
  received_on: string;
  due_on: string;
  extended_to: string | null;
  extension_reason: string | null;
  assigned_to: string | null;
  closed_at: string | null;
  outcome_note: string | null;
  organisations: { name: string } | null;
  profiles: { full_name: string | null; email: string | null } | null;
}

const SELECT = `
  id, org_id, subject_email, subject_name, kind, status,
  received_on, due_on, extended_to, extension_reason,
  assigned_to, closed_at, outcome_note,
  organisations:org_id ( name ),
  profiles:assigned_to ( full_name, email )
`;

function toRequest(row: RequestRow): GdprRequest {
  return {
    id: row.id,
    orgId: row.org_id,
    // Null rather than a placeholder: "which tenant is this about" is
    // legitimately unknown when a request first arrives by email, and the
    // screen shows that as an unresolved state worth acting on.
    orgName: row.organisations?.name ?? null,
    subjectEmail: row.subject_email,
    subjectName: row.subject_name,
    kind: row.kind as GdprRequestKind,
    status: row.status as GdprRequestStatus,
    receivedOn: row.received_on,
    dueOn: row.due_on,
    extendedTo: row.extended_to,
    extensionReason: row.extension_reason,
    assignedTo: row.assigned_to,
    assigneeName: row.profiles?.full_name ?? row.profiles?.email ?? null,
    closedAt: row.closed_at,
    outcomeNote: row.outcome_note,
  };
}

/** Every request this account may see. Oldest deadline first. The useful order. */
export async function listGdprRequests(limit = 200): Promise<GdprRequest[]> {
  const { data, error } = await supabase
    .from('gdpr_requests')
    .select(SELECT)
    .order('due_on', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as unknown as RequestRow[]).map(toRequest);
}

/** Log a newly received request. The database computes the statutory deadline. */
export async function logGdprRequest(input: {
  subjectEmail: string;
  subjectName?: string;
  kind: GdprRequestKind;
  orgId?: string | null;
  receivedOn?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('log_gdpr_request', {
    p_subject_email: input.subjectEmail,
    p_subject_name: input.subjectName ?? null,
    p_kind: input.kind,
    p_org: input.orgId ?? null,
    p_received_on: input.receivedOn ?? null,
  });
  if (error) throw error;
  return data;
}

/**
 * Move a request along. Closing it (`completed` or `refused`) requires a note
 * saying what was done. The database refuses without one.
 */
export async function setGdprRequestStatus(
  requestId: string,
  status: GdprRequestStatus,
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc('set_gdpr_request_status', {
    p_request: requestId,
    p_status: status,
    p_note: note ?? null,
  });
  if (error) throw error;
}

/**
 * Take the Article 12(3) extension. Returns the new deadline.
 *
 * Owner or admin only, once per request, and it needs a reason, an extension
 * nobody justified is indistinguishable from a missed deadline.
 */
export async function extendGdprRequest(
  requestId: string,
  reason: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('extend_gdpr_request', {
    p_request: requestId,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}
