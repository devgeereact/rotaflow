import { ApiError } from '@/lib/api';
import type { StaffDocument, StaffDocumentInsert } from '@/types';

/**
 * Staff documents. They arrive with the compliance module (R2, slice S10: document types, submit and review,
 * expiry reminders, eligibility), which has no API yet. Until then the screens are hidden behind the
 * `staff_documents` feature flag (useFeatureAccess), reads answer empty, and writes are refused with a sentence
 * rather than failing at the network.
 */

/** The feature flag that shows the documents screens. The platform turns it on when S10 ships. */
export const STAFF_DOCUMENTS_FEATURE = 'staff_documents';

const NOT_YET =
  'Staff documents are not available yet. They arrive with the compliance module.';

export async function listDocuments(
  _orgId: string,
  _staffProfileId: string,
): Promise<StaffDocument[]> {
  return Promise.resolve([]);
}

export async function listExpiringDocuments(
  _orgId: string,
  _beforeDate: string,
): Promise<StaffDocument[]> {
  return Promise.resolve([]);
}

export type NewDocumentDetails = Omit<StaffDocumentInsert, 'file_url' | 'storage_path'>;

export async function uploadDocument(
  _details: NewDocumentDetails,
  _file: File,
): Promise<StaffDocument> {
  return Promise.reject(new ApiError(405, 'not_available', NOT_YET));
}

export async function documentOpenUrl(_doc: StaffDocument): Promise<string> {
  return Promise.reject(new ApiError(405, 'not_available', NOT_YET));
}

export async function createDocument(
  _input: StaffDocumentInsert,
): Promise<StaffDocument> {
  return Promise.reject(new ApiError(405, 'not_available', NOT_YET));
}

export async function deleteDocument(_orgId: string, _id: string): Promise<void> {
  return Promise.reject(new ApiError(405, 'not_available', NOT_YET));
}
