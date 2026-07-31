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
