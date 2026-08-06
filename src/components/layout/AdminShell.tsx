import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ArrowLeft, ChevronUp, LogOut, Menu, RefreshCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { env } from '@/lib/env';
import { useOrg } from '@/hooks/useOrg';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import {
  ConsoleRefreshContext,
  type ConsoleRefreshValue,
} from '@/hooks/useConsoleRefresh';
import {
  ADMIN_SECONDARY_NAV,
  CONSOLE_MENU_TARGET,
  adminNavForRole,
  type AdminNavItem,
} from '@/lib/adminNav';
import { PLATFORM_ROLE_LABELS } from '@/lib/platformRoles';
import { BrandMark } from '@/components/ui/BrandMark';
import { StaffAvatar } from '@/components/ui/StaffAvatar';

const LINK_BASE =
  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.84rem] font-medium transition-colors';
const LINK_INACTIVE =
  'text-content hover:bg-primary-wash dark:text-content-dark dark:hover:bg-primary-wash-dark';
const LINK_ACTIVE = 'bg-primary text-primary-fg';

const EYEBROW =
  'text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-content-muted dark:text-content-muted-dark';

/**
 * Which deployment this is.
 *
 * Production is the restrained red; anything else is amber. The distinction
 * carries real weight here. The entire point of an environment badge on an
 * admin console is that "I thought I was on staging" is a sentence which
 * precedes a very bad afternoon. `env.mode` is Vite's build mode, so this
 * reports what was actually built rather than what anyone assumed.
 */
function environmentBadge(): { label: string; className: string } {
  if (env.isProd) {
    return {
      label: 'Production',
      className:
        'bg-danger-wash text-danger ring-1 ring-inset ring-danger/30 dark:bg-danger-wash-dark',
    };
  }
  return {
    label: env.mode === 'staging' ? 'Staging' : 'Development',
    className:
      'bg-warning-wash text-warning ring-1 ring-inset ring-warning/30 dark:bg-warning-wash-dark',
  };
}

function NavList({
  items,
  onNavigate,
}: {
  items: readonly AdminNavItem[];
  onNavigate?: () => void;
}): JSX.Element {
  return (
    <>
      {items.map(({ label, icon: Icon, to, end }) => (
        <NavLink
          key={`${to}-${label}`}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(LINK_BASE, isActive ? LINK_ACTIVE : LINK_INACTIVE)
          }
        >
          {({ isActive }) => (
            <>
              <Icon
                size={16}
                aria-hidden="true"
                className={cn('shrink-0', isActive ? 'opacity-100' : 'opacity-75')}
              />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </>
  );
}

/**
 * Brand, area and environment.
 *
 * The mark is the product's own. This area is RotaFlow, not a separate
 * product, and everything that says "you are not in a tenant" is carried by
 * the eyebrow and the environment badge underneath it rather than by recolouring
 * the console.
 *
 * There is no region chip beside the badge, which the reference shows: nothing
 * in `env` reports the deployment region, and a guessed one printed next to a
 * badge whose entire job is preventing a wrong assumption about where you are
 * would be worse than an absent one.
 */
function ConsoleIdentity(): JSX.Element {
  const badge = environmentBadge();
  return (
    <div className="px-2">
      <div className="flex items-center gap-2.5 pb-3">
        <BrandMark label={null} className="h-[30px] w-[30px]" />
        <div>
          <p className="font-display text-[0.95rem] font-bold leading-tight tracking-tight text-content dark:text-content-dark">
            RotaFlow
          </p>
          <p className={EYEBROW}>Platform console</p>
        </div>
      </div>
      <span
        className={cn(
          'inline-block rounded-full px-[7px] py-[5px] font-mono text-[0.625rem] font-semibold uppercase leading-none tracking-[0.08em]',
          badge.className,
        )}
      >
        {badge.label}
      </span>
    </div>
  );
}

/**
 * The role this session is actually acting as.
 *
 * The reference renders a role *switcher* here, which is a prototype
 * affordance. It exists so the reader can see the console re-resolve. A real
 * platform role comes from `platform_admins` and is enforced by the route
 * guards and by `has_platform_role(...)` in the policies, so it is read here,
 * never chosen.
 */
function ConsoleRole(): JSX.Element {
  const { platformRole } = useOrg();
  return (
    <div className="grid gap-1.5 px-2 pb-3">
      <p className={EYEBROW}>Signed in as</p>
      <p className="rounded-lg border border-surface-border bg-surface px-2.5 py-[7px] text-[0.8rem] font-medium text-content dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark">
        {/* Never "Administrator" as a guess. If the granular role could not be
            read, say so. This line is how someone checks what they are about
            to act as. */}
        {platformRole ? PLATFORM_ROLE_LABELS[platformRole] : 'Platform role unavailable'}
      </p>
    </div>
  );
}

/** Reference material and who you are. */
function ConsoleFooter({ onNavigate }: { onNavigate?: () => void }): JSX.Element {
  const { user, signOut } = useSupabaseAuth();
  const { platformRole } = useOrg();
  const [menuOpen, setMenuOpen] = useState(false);

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? '';
  const [first = '', last = ''] = displayName.split(/[\s@.]+/);

  return (
    <div className="mt-auto grid gap-0.5 border-t border-divider px-2 pt-3 dark:border-divider-dark">
      <NavList items={ADMIN_SECONDARY_NAV} onNavigate={onNavigate} />

      {/* The way out of the console lives here rather than in the nav.
          "Return to organisation" is not a sixteenth platform screen, and a
          list is the wrong shape for it. Clicking your own name to leave is
          the pattern every admin console uses. */}
      <div className="relative mt-1">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark"
        >
          <StaffAvatar firstName={first} lastName={last} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.8rem] font-semibold leading-tight text-content dark:text-content-dark">
              {displayName}
            </p>
            <p className="truncate text-[0.69rem] leading-tight text-content-muted dark:text-content-muted-dark">
              {platformRole
                ? PLATFORM_ROLE_LABELS[platformRole]
                : 'Platform role unavailable'}
            </p>
          </div>
          <ChevronUp
            size={14}
            aria-hidden="true"
            className={cn(
              'shrink-0 text-content-muted transition-transform dark:text-content-muted-dark',
              !menuOpen && 'rotate-180',
            )}
          />
        </button>

        {menuOpen && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setMenuOpen(false)}
            />
            <div
              role="menu"
              className="absolute bottom-full left-0 z-50 mb-1 w-full overflow-hidden rounded-lg border border-surface-border bg-surface py-1 shadow-lg dark:border-surface-border-dark dark:bg-surface-dark"
            >
              <Link
                to={CONSOLE_MENU_TARGET}
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onNavigate?.();
                }}
                className="flex items-center gap-2 px-3 py-2 text-sm text-content hover:bg-surface-subtle dark:text-content-dark dark:hover:bg-surface-subtle-dark"
              >
                <ArrowLeft size={15} aria-hidden="true" />
                Return to organisation
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => void signOut()}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-danger-wash dark:hover:bg-danger-wash-dark"
              >
                <LogOut size={15} aria-hidden="true" />
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Rail contents, shared by the fixed sidebar and the mobile drawer. */
function ConsoleRail({
  items,
  onNavigate,
}: {
  items: readonly AdminNavItem[];
  onNavigate?: () => void;
}): JSX.Element {
  return (
    <>
      <ConsoleIdentity />
      <div className="pt-3">
        <ConsoleRole />
      </div>
      <nav aria-label="Platform administration" className="grid gap-px px-2">
        <p className={cn(EYEBROW, 'px-2 pb-1.5 pt-3')}>Platform</p>
        <NavList items={items} onNavigate={onNavigate} />
      </nav>
      <ConsoleFooter onNavigate={onNavigate} />
    </>
  );
}

/** "Platform Console / Organisations", from the nav entry the URL matches. */
function useCrumbs(items: readonly AdminNavItem[]): string | null {
  const { pathname } = useLocation();
  return useMemo(() => {
    // Secondary entries are searched too: System Status is the only way into
    // the health screen, and resolving crumbs from the primary nav alone left
    // that page with a bare "Platform Console" and no name.
    const match = [...items, ...ADMIN_SECONDARY_NAV]
      .filter((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to)))
      .sort((a, b) => b.to.length - a.to.length)[0];
    return match?.label ?? null;
  }, [items, pathname]);
}

/**
 * Shell for `/admin/*`.
 *
 * ## Why it does not reuse `AppShell`
 *
 * `AppShell` is built around an organisation: it renders the org switcher, the
 * role-filtered sidebar and the tenant-scoped search, and every one of those is
 * meaningless, or actively misleading, in an area whose whole point is that
 * it sits *above* organisations. A platform admin here is not acting as a
 * member of the org they happen to have selected, and a shell implying they are
 * invites exactly the mistake this area must not make.
 *
 * ## Why the accent is `primary` again
 *
 * This console used to tint every surface `danger`, so that a screenshot of
 * cross-tenant data could not be mistaken for a tenant's own. It was traded for
 * the reference's treatment (`docs/PLATFORM_CONSOLE.html`): `primary` for
 * interaction, `danger` reserved for the environment badge and for destructive
 * actions. Spending the alarm colour on *navigation* left nothing louder for
 * "suspend this organisation", and a console that is red all over is a console
 * where red stops meaning anything. Separation is carried instead by the
 * PLATFORM CONSOLE eyebrow, the environment badge, the rail treatment and the
 * standing cross-tenant banner. All of which stay.
 *
 * ## The mobile drawer
 *
 * The console's navigation used to live inline inside the warning banner on
 * small screens, a wrapped row of plain links, which was proportionate when
 * there were seven of them and none was role-filtered. It is now a proper
 * drawer sharing `useFocusTrap` with `Sidebar`, so both shells trap focus,
 * close on Escape and hide the page behind them by the same code rather than
 * two copies that drift.
 */
export function AdminShell(): JSX.Element {
  const { platformRole } = useOrg();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [refresh, setRefresh] = useState<(() => void) | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const closeDrawer = useCallback(() => setMobileOpen(false), []);

  useFocusTrap(drawerRef, mobileOpen, closeDrawer);

  const items = adminNavForRole(platformRole);
  const crumb = useCrumbs(items);

  // `register` must be stable: `useRegisterConsoleRefresh` has it in a
  // dependency array, and an identity that changed every render would
  // re-register on every render.
  const register = useCallback((fn: (() => void) | null) => {
    setRefresh(() => fn);
  }, []);
  const refreshValue = useMemo<ConsoleRefreshValue>(
    () => ({ refresh, register }),
    [refresh, register],
  );

  return (
    <ConsoleRefreshContext.Provider value={refreshValue}>
      <div className="min-h-screen bg-background md:grid md:grid-cols-[264px_1fr] dark:bg-background-dark">
        <aside className="sticky top-0 hidden h-screen flex-col gap-0.5 overflow-y-auto border-r border-surface-border bg-surface-rail px-3 pb-3 pt-4 md:flex dark:border-surface-border-dark dark:bg-surface-rail-dark">
          <ConsoleRail items={items} />
        </aside>

        <div className="flex min-w-0 flex-col">
          {/* Standing reminder of whose data is on screen. A banner rather than a
              one-time toast because the risk. Acting on a customer's live data
              believing it is your own. Lasts as long as the session does. */}
          <div className="flex items-center gap-3 border-b border-danger/20 bg-danger-wash px-4 py-2 dark:bg-danger-wash-dark">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open platform navigation"
              aria-expanded={mobileOpen}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger md:hidden"
            >
              <Menu size={18} aria-hidden="true" />
            </button>
            <p className="text-xs font-medium text-danger">
              Platform administration. You are viewing data belonging to every
              organisation on RotaFlow.
            </p>
          </div>

          <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-surface-border bg-background/90 px-4 py-2.5 backdrop-blur lg:px-6 dark:border-surface-border-dark dark:bg-background-dark/90">
            <p className="flex min-w-0 items-center gap-1.5 truncate text-[0.78rem] text-content-muted dark:text-content-muted-dark">
              Platform Console
              {crumb ? (
                <>
                  <span aria-hidden="true">/</span>
                  <span className="font-semibold text-content dark:text-content-dark">
                    {crumb}
                  </span>
                </>
              ) : null}
            </p>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              {/* Absent, rather than dead, until the screen under it offers a
                  refetch. See `useConsoleRefresh`. */}
              {refresh ? (
                <button
                  type="button"
                  onClick={refresh}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface px-2.5 py-1.5 text-xs font-medium text-content shadow-sm transition-colors hover:bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  Refresh
                </button>
              ) : null}
              <Link
                to="/admin/support-access"
                className="inline-flex items-center rounded-lg border border-surface-border bg-surface px-2.5 py-1.5 text-xs font-medium text-content shadow-sm transition-colors hover:bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
              >
                Request support access
              </Link>
            </div>
          </div>

          <main className="w-full max-w-[1440px] p-4 lg:p-6">
            <Outlet />
          </main>
        </div>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              aria-label="Close platform navigation"
              onClick={closeDrawer}
              className="absolute inset-0 cursor-default bg-black/40"
            />
            <div
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label="Platform administration"
              tabIndex={-1}
              className="absolute inset-y-0 left-0 flex w-[264px] max-w-[85%] flex-col gap-0.5 overflow-y-auto border-r border-surface-border bg-surface-rail px-3 pb-3 pt-4 dark:border-surface-border-dark dark:bg-surface-rail-dark"
            >
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Close platform navigation"
                className="absolute right-3 top-4 grid h-8 w-8 place-items-center rounded-lg text-content-muted hover:bg-surface-subtle dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
              >
                <X size={18} aria-hidden="true" />
              </button>
              <ConsoleRail items={items} onNavigate={closeDrawer} />
            </div>
          </div>
        )}
      </div>
    </ConsoleRefreshContext.Provider>
  );
}
