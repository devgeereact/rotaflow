import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import { env } from '@/lib/env';

/**
 * Singleton Supabase client, typed against the generated Database schema.
 * The anon key is safe in the browser because access is gated by RLS.
 *
 * `createClient` throws synchronously on an empty URL, which would crash the
 * whole module graph (and therefore every page, including ones that never
 * touch Supabase) when VITE_SUPABASE_URL is unset — see env.ts's
 * `requireKeys`, which already warns instead of throwing for exactly this
 * reason. Fall back to a syntactically valid placeholder so the client
 * degrades (real calls fail at the network layer) instead of taking down
 * the app at import time.
 */
export const supabase = createClient<Database>(
  env.supabaseUrl || 'https://placeholder.invalid',
  env.supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true, // needed for OAuth + magic-link redirects
      flowType: 'pkce',
    },
  },
);
