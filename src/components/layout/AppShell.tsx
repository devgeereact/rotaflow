import { Navigate, Outlet } from 'react-router-dom';
import { useOrg } from '@/hooks/useOrg';
import { SplashScreen } from '@/components/SplashScreen';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

/**
 * Tenant shell for every /app/* route: gates on org membership (redirecting
 * to /onboarding if the user belongs to none) and renders the sidebar/header
 * chrome around the routed page. ProtectedRoute (auth-only) wraps this.
 */
export function AppShell(): JSX.Element {
  const { loading, loadFailed, memberships, refresh } = useOrg();

  if (loading) return <SplashScreen />;

  // Check the failure first. An unreachable memberships query also yields an
  // empty list, and redirecting on that would tell an existing owner to create
  // an organisation they already have — and let them create a duplicate.
  if (loadFailed && memberships.length === 0) {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <Card className="w-full max-w-sm text-center">
          <h1 className="mb-1 font-display text-xl text-content dark:text-content-dark">
            Couldn&rsquo;t load your organisations
          </h1>
          <p className="mb-6 text-sm text-content-muted dark:text-content-muted-dark">
            You&rsquo;re still signed in and nothing has been lost. Check your
            connection and try again.
          </p>
          <Button className="w-full" onClick={() => void refresh()}>
            Retry
          </Button>
        </Card>
      </main>
    );
  }

  if (memberships.length === 0) return <Navigate to="/onboarding" replace />;

  return (
    <div className="flex min-h-screen bg-background dark:bg-background-dark">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto px-6 py-8 md:px-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
