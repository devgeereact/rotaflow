import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { SplashScreen } from '@/components/SplashScreen';

/** Gate a route on an authenticated session; redirect to /login otherwise. */
export function ProtectedRoute({ children }: { children: ReactNode }): JSX.Element {
  const { user, loading } = useSupabaseAuth();
  const location = useLocation();

  if (loading) {
    return <SplashScreen />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
