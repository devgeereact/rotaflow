import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';

/**
 * Access the current sign-in state. Must be used within <AuthProvider>.
 * The provider owns the Clerk session and the `GET /me` read; this hook just reads it.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth must be used within an <AuthProvider>.');
  }
  return ctx;
}
