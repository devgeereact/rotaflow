import { Suspense, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { RouteFallback } from '@/components/RouteFallback';
import { useOrg } from '@/hooks/useOrg';
import { AppBootScreen } from '@/components/AppBootScreen';
import { SupportAccessBanner } from '@/components/layout/SupportAccessBanner';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileTabBar } from '@/components/layout/MobileTabBar';
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
  const [navOpen, setNavOpen] = useState(false);

  // Auth already resolved to reach AppShell; only the org query is outstanding.
  if (loading) return <AppBootScreen authResolved orgResolved={false} />;

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
            You&rsquo;re still signed in and nothing has been lost. Check your connection
            and try again.
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
    /*
     * The shell is exactly one viewport tall and does not scroll. Only `main`
     * does.
     *
     * This was `min-h-screen`, which grows with its content — so `main`'s
     * `overflow-y-auto` had no bounded parent to scroll inside, the whole
     * document scrolled instead, and the sidebar and header slid away with it.
     * On a long rota you lost the navigation entirely and had to scroll back up
     * to change screen.
     *
     * `100dvh` rather than `100vh`: on mobile Safari and Chrome `vh` is fixed to
     * the *largest* viewport, so with the address bar showing, `h-screen` is
     * taller than what you can see and the bottom of the sidebar — the profile
     * block and collapse control — sits below the fold with no way to reach it.
     * `dvh` tracks the visible height as the browser chrome moves.
     */
    <div className="flex h-[100dvh] overflow-hidden bg-background dark:bg-background-dark">
      {/* Drawer state lives here rather than inside Sidebar so the mobile tab
          bar's `More` opens the same drawer. Two components owning one panel
          is the alternative, and it desyncs the moment either can close it. */}
      <Sidebar mobileOpen={navOpen} onMobileOpenChange={setNavOpen} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header />
        {/* Above the scroll container, not inside it: a customer must not be
            able to scroll away the notice that their data is being viewed. */}
        <SupportAccessBanner />
        {/* `pb-20` on mobile clears the fixed tab bar; without it the last row
            of every table sits underneath it and cannot be reached. */}
        <main className="flex-1 overflow-y-auto px-6 pb-20 pt-8 md:px-10 md:pb-8">
          {/* Scoped to the content region on purpose. A Suspense boundary
              higher up would unmount the sidebar and header while a lazy route
              chunk loads, so every in-app navigation would flash the chrome. */}
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <MobileTabBar onOpenMore={() => setNavOpen(true)} />
    </div>
  );
}
