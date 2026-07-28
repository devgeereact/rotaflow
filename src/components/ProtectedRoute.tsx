import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';

/** Gate a route on an authenticated session; redirect to /login otherwise. */
export function ProtectedRoute({ children }: { children: ReactNode }): JSX.Element {
  const { user, loading } = useSupabaseAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-surface-border border-t-primary"
          aria-label="Loading"
          role="status"
        />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
