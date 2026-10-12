import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { MfaGate } from '@/components/auth/MfaGate';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { AppBootScreen } from '@/components/AppBootScreen';

/** Gate a route on an authenticated session; redirect to /login otherwise. */
export function ProtectedRoute({ children }: { children: ReactNode }): JSX.Element {
  const { user, loading } = useSupabaseAuth();
  const location = useLocation();

  if (loading) {
    // Auth is still resolving, so org resolution has not begun.
    return <AppBootScreen authResolved={false} orgResolved={false} />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // A signed-in session may still owe its second factor (CAP-049). The gate
  // holds everything protected, the platform console included, until it is
  // given.
  return <MfaGate>{children}</MfaGate>;
}
