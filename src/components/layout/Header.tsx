import { Link } from 'react-router-dom';
import { LifeBuoy } from 'lucide-react';
import { GlobalSearch } from '@/components/layout/GlobalSearch';
import { UserMenu } from '@/components/layout/UserMenu';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { BrandMark } from '@/components/ui/BrandMark';

/**
 * Top bar for the `/app/*` shell. Page-specific chrome (the rota's week nav,
 * a table's filters) lives in the page itself.
 *
 * ## Two things that used to be here and are not
 *
 * The **organisation name** was rendered as a bare label on the left. It now
 * lives in the sidebar's `SidebarOrgSwitcher`, next to the switcher itself,
 * which is where someone looks to answer "which tenant am I in" — and it stops
 * the name appearing twice on one screen saying the same thing.
 *
 * The **`OrgSwitcher` select** was here too, and is now the same sidebar
 * control. One switcher, one place.
 *
 * On mobile the sidebar is a drawer, so the logo returns to the header as the
 * only always-visible brand anchor and as a link home.
 */
export function Header(): JSX.Element {
  // `shrink-0` below: the header is a flex child of AppShell's fixed-height
  // column, so without it the browser compresses it as the content region grows.
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-surface-border bg-surface px-4 md:px-6 dark:border-surface-border-dark dark:bg-surface-dark">
      <Link to="/app/dashboard" className="flex shrink-0 items-center gap-2 md:hidden">
        <BrandMark label={null} className="h-8 w-8" />
        <span className="font-display text-base font-bold text-content dark:text-content-dark">
          Rota<span className="text-primary">Flow</span>
        </span>
      </Link>

      <div className="hidden min-w-0 flex-1 md:block">
        <GlobalSearch />
      </div>

      <div className="flex shrink-0 items-center gap-2 md:gap-3">
        <div className="md:hidden">
          <GlobalSearch />
        </div>
        <Link
          to="/contact"
          aria-label="Help and support"
          title="Help and support"
          className="hidden h-10 w-10 place-items-center rounded-xl text-content-muted hover:bg-surface-subtle hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:grid dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark dark:hover:text-content-dark"
        >
          <LifeBuoy size={18} aria-hidden="true" />
        </Link>
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
