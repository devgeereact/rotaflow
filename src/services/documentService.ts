import { api, ApiError, orgPath, seg } from '@/lib/api';
import type { ComplianceDocument, DocumentType, Requirement } from '@/lib/compliance';
import type { StaffDocument } from '@/types';

/**
 * Staff documents and compliance (R2, slice S10): document types, uploads that wait for review,
 * the review queue, and the summaries behind the eligibility chip. Every rule is the API's
 * (backend/src/Mod/Compliance.php); these functions only carry requests.
 *
 * The screens stay behind the `staff_documents` feature flag (useFeatureAccess) so the module can
 * ship dark until the platform turns it on.
 */

/** The feature flag that shows the documents screens. */
export const STAFF_DOCUMENTS_FEATURE = 'staff_documents';

export interface DocumentPreset {
  key: string;
  name: string;
  description: string;
  requires_expiry: boolean;
  default_validity_months: number | null;
  required: boolean;
  added: boolean;
}

export interface DocumentTypeInput {
  name: string;
  description: string;
  requires_expiry: boolean;
  default_validity_months: number | null;
  required: boolean;
}

export interface NewDocument {
  staff_profile_id: string;
  document_type_id: string;
  name?: string;
  issued_at?: string | null;
  expires_at?: string | null;
  /** Send for review now (default) or keep as a draft. */
  submit?: boolean;
}

export interface QueuedDocument extends ComplianceDocument {
  staff_name: string;
  own: boolean;
  can_approve: boolean;
}

export interface ComplianceCounts {
  required: number;
  approved: number;
  expiring: number;
  expired: number;
  awaiting_review: number;
  missing: number;
  eligible: boolean;
}

export interface MyCompliance {
  today: string;
  staff_profile_id: string | null;
  requirements: Requirement[];
  counts: ComplianceCounts;
  documents: ComplianceDocument[];
}

export interface PersonEligibility {
  staff_profile_id: string;
  eligible: boolean;
  missing: string[];
  expiring: { name: string; expires_at: string | null }[];
}

export interface OrgComplianceSummary {
  scope: 'org';
  today: string;
  counts: {
    awaiting_review: number;
    expiring: number;
    expired: number;
    missing: number;
    not_eligible: number;
    people: number;
  };
  by_type: {
    type_id: string;
    name: string;
    approved: number;
    expiring: number;
    expired: number;
    awaiting_review: number;
    missing: number;
  }[];
  people: PersonEligibility[];
}

// ---- types ------------------------------------------------------------------------------------

export async function listDocumentTypes(
  orgId: string,
): Promise<{ types: DocumentType[]; presets?: DocumentPreset[] }> {
  return api.get(orgPath(orgId, '/document-types'));
}

export async function createDocumentType(
  orgId: string,
  input: DocumentTypeInput,
): Promise<DocumentType> {
  const r = await api.post<{ type: DocumentType }>(
    orgPath(orgId, '/document-types'),
    input,
  );
  return r.type;
}

export async function addPresetType(orgId: string, key: string): Promise<DocumentType> {
  const r = await api.post<{ type: DocumentType }>(
    orgPath(orgId, '/document-types/presets'),
    { key },
  );
  return r.type;
}

export async function updateDocumentType(
  orgId: string,
  type: Pick<DocumentType, 'id' | 'version'>,
  input: DocumentTypeInput,
): Promise<DocumentType> {
  const r = await api.post<{ type: DocumentType }>(
    orgPath(orgId, `/document-types/${seg(type.id)}/update`),
    { ...input, expected_version: type.version },
  );
  return r.type;
}

export async function archiveDocumentType(
  orgId: string,
  type: Pick<DocumentType, 'id' | 'version'>,
): Promise<DocumentType> {
  const r = await api.post<{ type: DocumentType }>(
    orgPath(orgId, `/document-types/${seg(type.id)}/archive`),
    { expected_version: type.version },
  );
  return r.type;
}

// ---- documents --------------------------------------------------------------------------------

/** One person's documents (owners and managers), or the caller's own (staff). History included. */
export async function listDocuments(
  orgId: string,
  staffProfileId?: string,
): Promise<StaffDocument[]> {
  const r = await api.get<{ documents: StaffDocument[] }>(
    orgPath(orgId, '/documents'),
    staffProfileId ? { staff_profile_id: staffProfileId } : undefined,
  );
  return r.documents;
}

/**
 * Approved documents expiring on or before a date, across the organisation (owners and managers;
 * staff get their own). Feeds the rota warnings, which only care about documents that count.
 */
export async function listExpiringDocuments(
  orgId: string,
  beforeDate: string,
): Promise<StaffDocument[]> {
  let all: StaffDocument[];
  try {
    all = await listDocuments(orgId);
  } catch (err) {
    // A reader the API keeps out of documents (a platform support session) still gets the rest
    // of the screen: these feed warnings, and none is the honest answer for someone who cannot see them.
    if (err instanceof ApiError && err.status === 403) return [];
    throw err;
  }
  return all.filter(
    (d) =>
      d.stored_status === 'approved' &&
      d.expires_at !== null &&
      d.expires_at <= beforeDate,
  );
}

async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Uploads the file and records it in one request. The API checks the type from the bytes. */
export async function uploadDocument(
  orgId: string,
  details: NewDocument,
  file: File,
): Promise<StaffDocument> {
  const r = await api.post<{ document: StaffDocument }>(orgPath(orgId, '/documents'), {
    ...details,
    data: await base64Of(file),
  });
  return r.document;
}

export async function submitDocument(
  orgId: string,
  doc: Pick<StaffDocument, 'id' | 'version'>,
): Promise<StaffDocument> {
  const r = await api.post<{ document: StaffDocument }>(
    orgPath(orgId, `/documents/${seg(doc.id)}/submit`),
    { expected_version: doc.version },
  );
  return r.document;
}

export async function withdrawDocument(
  orgId: string,
  doc: Pick<StaffDocument, 'id' | 'version'>,
): Promise<StaffDocument> {
  const r = await api.post<{ document: StaffDocument }>(
    orgPath(orgId, `/documents/${seg(doc.id)}/withdraw`),
    { expected_version: doc.version },
  );
  return r.document;
}

export async function reviewDocument(
  orgId: string,
  doc: Pick<StaffDocument, 'id' | 'version'>,
  decision: 'approve' | 'reject',
  reason?: string,
): Promise<StaffDocument> {
  const r = await api.post<{ document: StaffDocument }>(
    orgPath(orgId, `/documents/${seg(doc.id)}/review`),
    { decision, expected_version: doc.version, ...(reason ? { reason } : {}) },
  );
  return r.document;
}

/** A link to open the file: a stored one lasts a minute; a moved row's pasted link is returned as it is. */
export async function documentOpenUrl(orgId: string, docId: string): Promise<string> {
  const r = await api.get<{ url: string | null }>(
    orgPath(orgId, `/documents/${seg(docId)}/link`),
  );
  if (!r.url) throw new Error('This document has no file.');
  return safeDocumentUrl(r.url);
}

/**
 * Only an https link, or a path on this site, is opened. The caller opens it in a window that shares the app's
 * origin, so a `javascript:` or `data:` value would run as the app (security audit, 1 Nov 2026).
 */
export function safeDocumentUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.origin);
  } catch {
    throw new Error('This document link cannot be opened.');
  }
  const sameSite = parsed.origin === window.location.origin;
  if (
    parsed.protocol !== 'https:' &&
    !(sameSite && parsed.protocol === window.location.protocol)
  ) {
    throw new Error('This document link cannot be opened.');
  }
  return parsed.href;
}

export async function reviewQueue(orgId: string): Promise<QueuedDocument[]> {
  const r = await api.get<{ documents: QueuedDocument[] }>(
    orgPath(orgId, '/documents/queue'),
  );
  return r.documents;
}

// ---- summaries --------------------------------------------------------------------------------

export async function myCompliance(orgId: string): Promise<MyCompliance> {
  return api.get<MyCompliance>(orgPath(orgId, '/compliance/me'));
}

/** Owners and managers: organisation numbers, by type, and each person's eligibility. */
export async function complianceSummary(orgId: string): Promise<OrgComplianceSummary> {
  return api.get<OrgComplianceSummary>(orgPath(orgId, '/compliance/summary'));
}
