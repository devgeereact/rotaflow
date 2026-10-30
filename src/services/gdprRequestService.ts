import { api, orgPath } from '@/lib/api';
import type {
  GdprRequest,
  GdprRequestKind,
  GdprRequestStatus,
  OwnDataRequest,
  SelfServiceKind,
} from '@/lib/gdprRequests';

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
  org_id?: string | null;
  org_name?: string | null;
  subject_email: string;
  subject_name?: string | null;
  kind: string;
  status: string;
  received_on: string;
  due_on: string;
  extended_to: string | null;
  extension_reason?: string | null;
  assigned_to?: string | null;
  closed_at: string | null;
  outcome_note?: string | null;
}

function toRequest(row: RequestRow, orgId: string | null = null): GdprRequest {
  return {
    id: row.id,
    orgId: row.org_id ?? orgId,
    orgName: row.org_name ?? null,
    subjectEmail: row.subject_email,
    subjectName: row.subject_name ?? null,
    kind: row.kind as GdprRequestKind,
    status: row.status as GdprRequestStatus,
    receivedOn: row.received_on,
    dueOn: row.due_on,
    extendedTo: row.extended_to,
    extensionReason: row.extension_reason ?? null,
    assignedTo: row.assigned_to ?? null,
    assigneeName: null,
    closedAt: row.closed_at,
    outcomeNote: row.outcome_note ?? null,
  };
}

export interface GdprRequestPage {
  rows: GdprRequest[];
  /** Rows matching the same predicates, from the server. Never `rows.length`. */
  total: number;
}

/**
 * Every request this account may see. Oldest deadline first, the useful order.
 *
 * Returns the server's exact count alongside the page, so the board can say
 * "showing 200 of 412" rather than presenting a truncated array as the whole
 * register. It used to return the array alone, and every tile on the screen was
 * computed over it and labelled as an estate total — including an "Export
 * register" that shipped the same subset under a complete-sounding name.
 */
export async function listGdprRequests(limit = 200): Promise<GdprRequestPage> {
  const r = await api.get<{ requests: RequestRow[]; total: number }>('/platform/gdpr');
  return {
    rows: r.requests.slice(0, limit).map((row) => toRequest(row)),
    total: r.total,
  };
}

/**
 * The requests raised for ONE organisation.
 *
 * The organisation detail page used to read the platform-wide list and filter
 * it in the browser. That list is ordered `due_on` ASCENDING and capped, so the
 * 200 it kept were the oldest-due across the whole estate — a request raised
 * for this tenant last week has the furthest-out deadline and was therefore the
 * first to be dropped. The tab then rendered "No export, deletion or correction
 * request has been raised for this organisation", which is a compliance claim
 * made from a truncated array.
 *
 * Scoped in the query instead. At tenant scope this needs no paging.
 */
export async function listGdprRequestsForOrg(orgId: string): Promise<GdprRequest[]> {
  const r = await api.get<{ requests: RequestRow[] }>(orgPath(orgId, '/gdpr'));
  return r.requests
    .map((row) => toRequest(row, orgId))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

/** Log a newly received request. The database computes the statutory deadline. */
export async function logGdprRequest(input: {
  subjectEmail: string;
  subjectName?: string;
  kind: GdprRequestKind;
  orgId?: string | null;
  receivedOn?: string;
}): Promise<string> {
  const r = await api.post<{ id: string }>('/platform/gdpr', {
    email: input.subjectEmail,
    name: input.subjectName ?? null,
    kind: input.kind,
    org_id: input.orgId ?? null,
    received_on: input.receivedOn ?? null,
  });
  return r.id;
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
  await api.post(`/platform/gdpr/${encodeURIComponent(requestId)}/status`, {
    status,
    note: note ?? null,
  });
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
  const r = await api.post<{ extended_to: string }>(
    `/platform/gdpr/${encodeURIComponent(requestId)}/extend`,
    { reason },
  );
  return r.extended_to;
}

/**
 * File a request for the signed-in person (`request_my_data`, 0160).
 *
 * The subject is the caller's own email, taken from `auth.users` in the
 * database; nothing here can name anybody else. Asking again for a kind that is
 * already open returns that request with `alreadyOpen`, so a double press is
 * one request and one clock.
 */
export async function requestMyData(
  kind: SelfServiceKind,
  orgId?: string | null,
): Promise<{ id: string; dueOn: string; alreadyOpen: boolean }> {
  const r = await api.post<{ id: string; due_on: string; already_open: boolean }>(
    '/me/data-requests',
    { kind, org_id: orgId ?? null },
  );
  return { id: r.id, dueOn: r.due_on, alreadyOpen: r.already_open };
}

/** The signed-in person's own requests, newest first (`my_data_requests`, 0160). */
export async function listMyDataRequests(): Promise<OwnDataRequest[]> {
  const r = await api.get<{ requests: RequestRow[] }>('/me/data-requests');
  return r.requests.map((row) => ({
    id: row.id,
    kind: row.kind as GdprRequestKind,
    status: row.status as GdprRequestStatus,
    receivedOn: row.received_on,
    dueOn: row.due_on,
    extendedTo: row.extended_to,
    closedAt: row.closed_at,
  }));
}
