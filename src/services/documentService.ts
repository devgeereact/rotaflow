import { supabase } from '@/lib/supabase';
import type { StaffDocument, StaffDocumentInsert } from '@/types';

export async function listDocuments(staffProfileId: string): Promise<StaffDocument[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
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

export async function deleteDocument(id: string): Promise<void> {
  const { error } = await supabase.from('documents').delete().eq('id', id);
  if (error) throw error;
}
