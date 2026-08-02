import { supabase } from '@/lib/supabase';
import type { StaffDocument, StaffDocumentInsert } from '@/types';

/**
 * `org_id` filters are defense-in-depth, not the real enforcement — RLS
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
 * `expires_at` filter itself — `null` never satisfies `lte`, which is the
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

export async function createDocument(input: StaffDocumentInsert): Promise<StaffDocument> {
  const { data, error } = await supabase
    .from('documents')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteDocument(orgId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('org_id', orgId)
    .eq('id', id);
  if (error) throw error;
}
