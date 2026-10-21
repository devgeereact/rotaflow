import { supabase } from '@/lib/supabase';
import { DOCUMENT_BUCKET, SIGNED_URL_SECONDS, documentObjectPath } from '@/lib/documentFiles';
import type { StaffDocument, StaffDocumentInsert } from '@/types';

/**
 * `org_id` filters are defense-in-depth, not the real enforcement. RLS
 * (0002_rotaflow.sql) already scopes every row by its own `org_id`
 * regardless of what a client sends. Adding them here costs nothing and
 * matches the pattern of never trusting a single layer.
 */
export async function listDocuments(
  orgId: string,
  staffProfileId: string,
): Promise<StaffDocument[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('org_id', orgId)
    .eq('staff_profile_id', staffProfileId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Every document in the org that has already expired or expires before
 * `beforeDate` ('YYYY-MM-DD').
 *
 * Documents with no expiry (a contract, typically) are excluded by the
 * `expires_at` filter itself, `null` never satisfies `lte`, which is the
 * behaviour wanted here: a document that cannot lapse cannot be a warning.
 */
export async function listExpiringDocuments(
  orgId: string,
  beforeDate: string,
): Promise<StaffDocument[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('org_id', orgId)
    .lte('expires_at', beforeDate)
    .order('expires_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export type NewDocumentDetails = Omit<StaffDocumentInsert, 'file_url' | 'storage_path'>;

/**
 * Upload a file to the private bucket and record it, in that order.
 *
 * The object goes first so a row never points at a file that is not there. If
 * the insert then fails, the object is removed again; if that removal fails
 * too, the file sits in the person's folder with no row, and the folder is
 * still swept when the person or the organisation is deleted (0159).
 */
export async function uploadDocument(
  details: NewDocumentDetails,
  file: File,
): Promise<StaffDocument> {
  const path = documentObjectPath(
    details.org_id,
    details.staff_profile_id,
    crypto.randomUUID(),
    file.name,
  );
  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  try {
    return await createDocument({ ...details, storage_path: path });
  } catch (err) {
    await supabase.storage.from(DOCUMENT_BUCKET).remove([path]);
    throw err;
  }
}

/**
 * The address to open a document at, asked for at the moment of opening.
 *
 * A stored file gets a signed link that expires in a minute, so the address in
 * a browser history or a forwarded message stops working almost at once. A
 * legacy row returns its pasted link unchanged.
 */
export async function documentOpenUrl(doc: StaffDocument): Promise<string> {
  if (doc.storage_path) {
    const { data, error } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUrl(doc.storage_path, SIGNED_URL_SECONDS);
    if (error) throw error;
    return data.signedUrl;
  }
  if (doc.file_url) return doc.file_url;
  throw new Error('This document has no file.');
}

export async function createDocument(input: StaffDocumentInsert): Promise<StaffDocument> {
  const { data, error } = await supabase
    .from('documents')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Removing the row is what removes the file: a trigger queues the object for
 * `purge-storage` in the same transaction (0159). The browser does not delete
 * the object itself, so a deletion can never leave a row pointing at nothing.
 */
export async function deleteDocument(orgId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('org_id', orgId)
    .eq('id', id);
  if (error) throw error;
}
