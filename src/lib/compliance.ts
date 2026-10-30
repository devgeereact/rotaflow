/**
 * Staff documents and compliance: the pure rules the screens share with the API.
 *
 * The API decides (backend/src/ComplianceRules.php); this is the browser's copy so a
 * screen can label a document or say whether someone is cleared for a shift on a given
 * day without another request. The vitest cases mirror the PHP suite's (230).
 *
 * - A document is valid up to and including its expiry date, and expired the next day.
 * - An upload never counts until an owner or manager approves it.
 * - Dates are calendar days (YYYY-MM-DD) in the organisation's timezone.
 */

/** What the API stores. `expired` is never stored, only shown. */
export type StoredDocumentStatus =
  | 'uploaded'
  | 'awaiting_review'
  | 'approved'
  | 'rejected'
  | 'withdrawn'
  | 'superseded';

export type DocumentStatus = StoredDocumentStatus | 'expired';

export type RequirementState =
  | 'approved'
  | 'expiring'
  | 'awaiting_review'
  | 'uploaded'
  | 'rejected'
  | 'expired'
  | 'missing';

export type ExpiryState = 'none' | 'valid' | 'expiring' | 'expired';

export const EXPIRING_DAYS = 30;

/** One staff document as the API returns it. */
export interface ComplianceDocument {
  id: string;
  staff_profile_id: string;
  document_type_id: string | null;
  /** The type's name when uploaded (free text on a row moved from before types existed). */
  type: string;
  name: string;
  /** A pasted link on a moved row; null for a stored file. */
  file_url: string | null;
  stored: boolean;
  mime: string | null;
  issued_at: string | null;
  expires_at: string | null;
  status: DocumentStatus;
  stored_status: StoredDocumentStatus;
  rejection_reason: string | null;
  uploaded_by: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  superseded_by: string | null;
  created_at: string;
  version: number;
}

export interface Requirement {
  type_id: string;
  name: string;
  state: RequirementState;
  expires_at: string | null;
}

export interface DocumentType {
  id: string;
  name: string;
  description: string;
  requires_expiry: boolean;
  default_validity_months: number | null;
  required: boolean;
  preset_key: string | null;
  status: 'active' | 'archived';
  version: number;
}

/** `YYYY-MM-DD` plus or minus whole days, on the calendar (no clock, so no DST). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Today's date in a timezone, at `now` (ms). */
export function localToday(timezone: string, now: number = Date.now()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(now));
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

export function expiryState(expiresAt: string | null, today: string): ExpiryState {
  if (expiresAt === null) return 'none';
  if (expiresAt < today) return 'expired';
  if (expiresAt <= addDays(today, EXPIRING_DAYS)) return 'expiring';
  return 'valid';
}

/** The status shown for one row: its stored status, or `expired` for a live one whose date has passed. */
export function displayStatus(
  stored: StoredDocumentStatus,
  expiresAt: string | null,
  today: string,
): DocumentStatus {
  const live =
    stored === 'uploaded' || stored === 'awaiting_review' || stored === 'approved';
  return live && expiresAt !== null && expiresAt < today ? 'expired' : stored;
}

/** Whether one requirement is met on `date`: approved, and not expired by then. */
export function requirementMetOn(req: Requirement, date: string): boolean {
  if (req.state !== 'approved' && req.state !== 'expiring') return false;
  return req.expires_at === null || req.expires_at >= date;
}

/** Eligibility on a date from a person's requirements: the names still missing on that day. */
export function eligibilityOn(
  requirements: Requirement[],
  date: string,
): { ok: boolean; missing: string[] } {
  const missing = requirements
    .filter((r) => !requirementMetOn(r, date))
    .map((r) => r.name);
  return { ok: missing.length === 0, missing };
}

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  uploaded: 'Draft',
  awaiting_review: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Not accepted',
  withdrawn: 'Withdrawn',
  superseded: 'Replaced',
  expired: 'Expired',
};

export const REQUIREMENT_LABELS: Record<RequirementState, string> = {
  approved: 'Approved',
  expiring: 'Expiring soon',
  awaiting_review: 'Awaiting review',
  uploaded: 'Draft, not sent',
  rejected: 'Not accepted',
  expired: 'Expired',
  missing: 'Missing',
};

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

export function statusTone(status: DocumentStatus | RequirementState): Tone {
  switch (status) {
    case 'approved':
      return 'success';
    case 'expiring':
    case 'awaiting_review':
    case 'uploaded':
      return 'warning';
    case 'expired':
    case 'rejected':
    case 'missing':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** What the person may do with their own row; managers may also withdraw an approved one. */
export function allowedActions(
  doc: Pick<ComplianceDocument, 'stored_status'>,
  canManage: boolean,
): { submit: boolean; withdraw: boolean } {
  const s = doc.stored_status;
  return {
    submit: s === 'uploaded',
    withdraw:
      s === 'uploaded' ||
      s === 'awaiting_review' ||
      s === 'rejected' ||
      (canManage && s === 'approved'),
  };
}
