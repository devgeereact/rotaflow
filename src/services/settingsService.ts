import { supabase } from '@/lib/supabase';
import type { AppSettings, AppSettingsUpdate } from '@/types';

/** Fetch the current user's settings row. */
export async function getSettings(userId: string): Promise<AppSettings | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Update the current user's settings. */
export async function updateSettings(
  userId: string,
  patch: AppSettingsUpdate,
): Promise<AppSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .update(patch)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}
