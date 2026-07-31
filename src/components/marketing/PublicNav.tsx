import { Link } from 'react-router-dom';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { Button } from '@/components/ui/Button';
import logo from '@/assets/logo.png';

/**
 * Nav bar for the marketing homepage (`/`) — the authenticated app shell has
 * its own `Header` with org context, deliberately not shared here. `/` is
 * reachable while signed in too (a bookmark, a magic-link/OAuth round trip),
 * so this mirrors HomePage's hero: a signed-in visitor sees a path back into
 * the app, not sign-in/sign-up links that make it look like nothing happened.
 */
export function PublicNav(): JSX.Element {
  const { user } = useSupabaseAuth();

  return (
    <header className="sticky top-0 z-20 border-b border-surface-border bg-surface/80 backdrop-blur dark:border-surface-border-dark dark:bg-surface-dark/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <img src={logo} alt="RotaFlow" className="h-8 w-8" />
          <span className="font-display text-lg font-bold text-content dark:text-content-dark">
            Rota<span className="text-primary">Flow</span>
          </span>
        </Link>

        <div className="flex items-center gap-3">
          {user ? (
            <Link to="/app/dashboard">
              <Button size="sm">Go to dashboard</Button>
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden text-sm font-medium text-content-muted hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark sm:block"
              >
                Sign in
              </Link>
              <Link to="/signup">
                <Button size="sm">Get started</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
