import { Navigate, Outlet } from 'react-router-dom';
import { useOrg } from '@/hooks/useOrg';
import { SplashScreen } from '@/components/SplashScreen';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';

/**
 * Tenant shell for every /app/* route: gates on org membership (redirecting
 * to /onboarding if the user belongs to none) and renders the sidebar/header
 * chrome around the routed page. ProtectedRoute (auth-only) wraps this.
 */
export function AppShell(): JSX.Element {
  const { loading, memberships } = useOrg();

  if (loading) return <SplashScreen />;
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
