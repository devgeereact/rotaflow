import { Link } from 'react-router-dom';
import logo from '@/assets/logo.png';

/**
 * Deliberately minimal. No social links, press mentions, or contact address —
 * none of those exist yet, and an unmonitored mailto or a link to a
 * nonexistent Twitter is worse than not having the row at all.
 */
export function PublicFooter(): JSX.Element {
  return (
    <footer className="border-t border-surface-border py-10 dark:border-surface-border-dark">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-center sm:flex-row sm:justify-between sm:text-left">
        <div className="flex items-center gap-2">
          <img src={logo} alt="" className="h-6 w-6" aria-hidden="true" />
          <span className="text-sm font-medium text-content dark:text-content-dark">
            RotaFlow
          </span>
        </div>

        <nav className="flex items-center gap-6 text-sm text-content-muted dark:text-content-muted-dark">
          <Link to="/login" className="hover:text-content dark:hover:text-content-dark">
            Sign in
          </Link>
          <Link to="/signup" className="hover:text-content dark:hover:text-content-dark">
            Get started
          </Link>
        </nav>

        <p className="text-xs text-content-muted dark:text-content-muted-dark">
          &copy; {new Date().getFullYear()} RotaFlow
        </p>
      </div>
    </footer>
  );
}
