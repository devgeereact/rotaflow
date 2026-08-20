import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { Button } from '@/components/ui/Button';
import { MARKETING_NAV, PRIMARY_CTA } from '@/lib/marketing';
import { cn } from '@/lib/utils';
import { BrandMark } from '@/components/ui/BrandMark';

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Nav bar for the public marketing site. The authenticated app shell has its
 * own `Header` with org context, deliberately not shared here.
 *
 * Every marketing route is reachable while signed in too (a bookmark, or a
 * magic-link/OAuth round trip landing back on `/`), so a signed-in visitor gets
 * a path back into the app rather than sign-in links that make it look like
 * nothing happened.
 *
 * The mobile menu is a real dialog: focus moves into it, Escape closes it and
 * Tab is trapped. The same treatment `Sidebar` gives its drawer. A nav that
 * traps a keyboard user is the kind of thing a click-through test never finds.
 */
export function PublicNav(): JSX.Element {
  const { user } = useSupabaseAuth();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { pathname } = useLocation();

  // Closing on navigation matters here in a way it does not in the app shell:
  // these links are same-page anchors as often as route changes, and leaving
  // the panel up means tapping a link appears to do nothing.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab' || !panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-30 border-b border-surface-border bg-surface/80 backdrop-blur dark:border-surface-border-dark dark:bg-surface-dark/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <BrandMark label={null} className="h-8 w-8" />
          <span className="font-display text-lg font-bold text-content dark:text-content-dark">
            Rota<span className="text-primary-ink">Flow</span>
          </span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-7 lg:flex">
          {MARKETING_NAV.map(({ label, to }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'rounded text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  isActive
                    ? 'text-primary'
                    : 'text-content-muted hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark',
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {user ? (
            <Link to="/app/dashboard">
              <Button size="sm">Go to dashboard</Button>
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden rounded text-sm font-medium text-content-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:block dark:text-content-muted-dark dark:hover:text-content-dark"
              >
                Log in
              </Link>
              <Link to="/signup" className="hidden sm:block">
                <Button size="sm">{PRIMARY_CTA}</Button>
              </Link>
            </>
          )}

          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="grid h-11 w-11 place-items-center rounded-xl border border-surface-border text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden dark:border-surface-border-dark dark:text-content-dark"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/40"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            tabIndex={-1}
            className="absolute inset-x-0 top-0 max-h-full overflow-y-auto bg-surface p-6 shadow-lg dark:bg-surface-dark"
          >
            <div className="mb-6 flex items-center justify-between">
              <span className="font-display text-lg font-bold text-content dark:text-content-dark">
                Rota<span className="text-primary-ink">Flow</span>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="grid h-11 w-11 place-items-center rounded-xl text-content-muted hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <nav aria-label="Main" className="flex flex-col">
              {MARKETING_NAV.map(({ label, to }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      'rounded-xl px-3 py-3 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-content hover:bg-surface-subtle dark:text-content-dark dark:hover:bg-surface-subtle-dark',
                    )
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>

            <div className="mt-6 flex flex-col gap-3 border-t border-surface-border pt-6 dark:border-surface-border-dark">
              {user ? (
                <Link to="/app/dashboard">
                  <Button className="w-full">Go to dashboard</Button>
                </Link>
              ) : (
                <>
                  <Link to="/signup">
                    <Button className="w-full">{PRIMARY_CTA}</Button>
                  </Link>
                  <Link to="/login">
                    <Button variant="secondary" className="w-full">
                      Log in
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
