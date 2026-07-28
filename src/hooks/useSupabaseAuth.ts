import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';

/**
 * Access the current auth session. Must be used within <AuthProvider>.
 * The provider owns the Supabase listener; this hook just reads it.
 */
export function useSupabaseAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useSupabaseAuth must be used within an <AuthProvider>.');
  }
  return ctx;
}
