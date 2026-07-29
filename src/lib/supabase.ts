import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import { env } from '@/lib/env';

/**
 * Singleton Supabase client, typed against the generated Database schema.
 * The anon key is safe in the browser because access is gated by RLS.
 */
export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // needed for OAuth + magic-link redirects
    flowType: 'pkce',
  },
});
