import type { ReactNode, JSX } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { AppBootScreen } from '@/components/AppBootScreen';
import { Button } from '@/components/ui/Button';

/**
 * Gate a route on a signed-in person the API recognises; redirect to /login otherwise. A second factor, when the
 * account has one, is asked for by Clerk during sign-in, so nothing here holds it.
 */
export function ProtectedRoute({ children }: { children: ReactNode }): JSX.Element {
  const { user, loading, signedIn, meFailed, refreshMe, signOut } = useAuth();
  const location = useLocation();

  if (loading) {
    // Auth is still resolving, so org resolution has not begun.
    return <AppBootScreen authResolved={false} orgResolved={false} />;
  }

  if (!signedIn) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!user || meFailed) {
    // Signed in with Clerk, but the API did not answer who this is. Never treated as signed out: that would bounce
    // between sign-in (which sees a session) and here.
    return (
      <main className="mx-auto mt-24 max-w-md space-y-4 px-6 text-center">
        <h1 className="font-display text-2xl font-bold text-ink dark:text-content-dark">
          We could not load your account
        </h1>
        <p className="text-ink-muted dark:text-content-muted-dark">
          Check your connection and try again. If it keeps happening, sign out and back
          in.
        </p>
        <div className="flex justify-center gap-3">
          <Button onClick={() => void refreshMe()}>Try again</Button>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
