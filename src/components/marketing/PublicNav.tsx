import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import logo from '@/assets/logo.png';

/**
 * Nav bar for signed-out marketing pages only (`/`). The authenticated app
 * shell has its own `Header` — deliberately not shared, since this one has no
 * org context and always routes to /login or /signup.
 */
export function PublicNav(): JSX.Element {
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
          <Link
            to="/login"
            className="hidden text-sm font-medium text-content-muted hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark sm:block"
          >
            Sign in
          </Link>
          <Link to="/signup">
            <Button size="sm">Get started</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
