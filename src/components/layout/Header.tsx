import { Link } from 'react-router-dom';
import { GlobalSearch } from '@/components/layout/GlobalSearch';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { BrandMark } from '@/components/ui/BrandMark';

/**
 * Top bar for the `/app/*` shell. Page-specific chrome (the rota's week nav,
 * a table's filters) lives in the page itself.
 *
 * Matches `docs/ORGANISATION_WORKSPACE.html`'s `.topbar`: breadcrumbs on the
 * left, notifications on the right. Nothing else.
 *
 * ## Things that used to be here and are not
 *
 * The **organisation name** was a bare label on the left, then moved into the
 * sidebar's `SidebarOrgSwitcher`. Breadcrumbs bring it back here too, but
 * paired with the current screen, "which tenant, which screen", not a repeat
 * of the switcher.
 *
 * **Search** moved to the rail as the `⌘K` row under the org switcher (see
 * `Sidebar`), so there is no second search control here competing for the
 * same shortcut.
 *
 * **The account avatar and its dropdown** moved into `SidebarFooter`'s
 * `.railfoot` group. Settings/My Profile, Help & Support, sign out are rows
 * there now, next to the identity card they act on, rather than a second
 * dropdown in the header repeating the first.
 *
 * On mobile the sidebar is a drawer, so the logo returns to the header as the
 * only always-visible brand anchor and as a link home.
 */
export function Header(): JSX.Element {
  // `shrink-0` below: the header is a flex child of AppShell's fixed-height
  // column, so without it the browser compresses it as the content region grows.
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-surface-border bg-surface/90 px-4 backdrop-blur md:px-6 dark:border-surface-border-dark dark:bg-surface-dark/90">
      <Link to="/app/dashboard" className="flex shrink-0 items-center gap-2 md:hidden">
        <BrandMark label={null} className="h-8 w-8" />
        <span className="font-display text-base font-bold text-content dark:text-content-dark">
          Rota<span className="text-primary">Flow</span>
        </span>
      </Link>

      <div className="hidden min-w-0 flex-1 md:block">
        <Breadcrumbs />
      </div>
      <div className="min-w-0 flex-1 md:hidden">
        <GlobalSearch />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <NotificationBell />
      </div>
    </header>
  );
}
