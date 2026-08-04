import { useCallback, useRef, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { ArrowLeft, Menu, ShieldCheck, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { env } from '@/lib/env';
import { useOrg } from '@/hooks/useOrg';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { ADMIN_SECONDARY_NAV, adminNavForRole, type AdminNavItem } from '@/lib/adminNav';
import { PLATFORM_ROLE_LABELS } from '@/lib/platformRoles';
import { BrandMark } from '@/components/ui/BrandMark';

const LINK_BASE =
  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors';
const LINK_INACTIVE =
  'text-content-muted hover:bg-surface-subtle hover:text-content dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark dark:hover:text-content-dark';
const LINK_ACTIVE = 'bg-danger/10 text-danger';

/**
 * Which deployment this is.
 *
 * Production is the restrained red; anything else is amber. The distinction
 * carries real weight here — the entire point of an environment badge on an
 * admin console is that "I thought I was on staging" is a sentence which
 * precedes a very bad afternoon. `env.mode` is Vite's build mode, so this
 * reports what was actually built rather than what anyone assumed.
 */
function environmentBadge(): { label: string; className: string } {
  if (env.isProd) {
    return {
      label: 'Production',
      className: 'bg-danger/10 text-danger ring-1 ring-inset ring-danger/30',
    };
  }
  return {
    label: env.mode === 'staging' ? 'Staging' : 'Development',
    className: 'bg-warning/15 text-warning ring-1 ring-inset ring-warning/30',
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
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(LINK_BASE, isActive ? LINK_ACTIVE : LINK_INACTIVE)
          }
        >
          <Icon size={18} aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </>
  );
}

function ConsoleIdentity(): JSX.Element {
  const badge = environmentBadge();
  return (
    <div className="px-5">
      <p className="flex items-center gap-2 font-display text-lg font-bold text-content dark:text-content-dark">
        <BrandMark label={null} className="h-7 w-7" />
        RotaFlow
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wider text-danger">
          <ShieldCheck size={13} aria-hidden="true" />
          Platform console
        </p>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide',
            badge.className,
          )}
        >
          {badge.label}
        </span>
      </div>
    </div>
  );
}

/** Name + resolved platform role, and the way back to the tenant app. */
function ConsoleFooter({ onNavigate }: { onNavigate?: () => void }): JSX.Element {
  const { user } = useSupabaseAuth();
  const { platformRole } = useOrg();

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? '';

  return (
    <div className="mt-6 space-y-1 px-3">
      <div className="mb-2 rounded-xl bg-surface-subtle px-3 py-2.5 dark:bg-surface-subtle-dark">
        <p className="truncate text-sm font-medium text-content dark:text-content-dark">
          {displayName}
        </p>
        <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
          {/* Never "Administrator" as a guess. If the granular role could not
              be read, say so — this line is how someone checks what they are
              about to act as. */}
          {platformRole
            ? PLATFORM_ROLE_LABELS[platformRole]
            : 'Platform role unavailable'}
        </p>
      </div>

      <NavList items={ADMIN_SECONDARY_NAV} onNavigate={onNavigate} />

      <Link
        to="/app/dashboard"
        onClick={onNavigate}
        className={cn(LINK_BASE, LINK_INACTIVE)}
      >
        <ArrowLeft size={18} aria-hidden="true" />
        Return to organisation
      </Link>
    </div>
  );
}

/**
 * Shell for `/admin/*`.
 *
 * ## Why it does not reuse `AppShell`
 *
 * `AppShell` is built around an organisation: it renders the org switcher, the
 * role-filtered sidebar and the tenant-scoped search, and every one of those is
 * meaningless — or actively misleading — in an area whose whole point is that
 * it sits *above* organisations. A platform admin here is not acting as a
 * member of the org they happen to have selected, and a shell implying they are
 * invites exactly the mistake this area must not make.
 *
 * The visual language is deliberately shared but the accent is not: platform
 * screens are tinted `danger` rather than `primary`, so a screenshot of this
 * area is never mistaken for a tenant's own. Cross-tenant data on screen should
 * look different from a customer's own data.
 *
 * ## The mobile drawer
 *
 * The console's navigation used to live inline inside the warning banner on
 * small screens — a wrapped row of plain links, which was proportionate when
 * there were seven of them and none was role-filtered. It is now a proper
 * drawer sharing `useFocusTrap` with `Sidebar`, so both shells trap focus,
 * close on Escape and hide the page behind them by the same code rather than
 * two copies that drift.
 */
export function AdminShell(): JSX.Element {
  const { platformRole } = useOrg();
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const closeDrawer = useCallback(() => setMobileOpen(false), []);

  useFocusTrap(drawerRef, mobileOpen, closeDrawer);

  const items = adminNavForRole(platformRole);

  return (
    <div className="flex min-h-screen bg-surface-subtle dark:bg-surface-subtle-dark">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-surface-border bg-surface py-5 md:flex dark:border-surface-border-dark dark:bg-surface-dark">
        <div className="mb-6">
          <ConsoleIdentity />
        </div>
        <nav aria-label="Platform administration" className="flex-1 space-y-1 px-3">
          <NavList items={items} />
        </nav>
        <ConsoleFooter />
      </aside>

      <div className="min-w-0 flex-1">
        {/* Standing reminder of whose data is on screen. A banner rather than a
            one-time toast because the risk — acting on a customer's live data
            believing it is your own — lasts as long as the session does. */}
        <div className="flex items-center gap-3 border-b border-danger/20 bg-danger/5 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open platform navigation"
            aria-expanded={mobileOpen}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger md:hidden"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <p className="text-xs font-medium text-danger">
            Platform administration — you are viewing data belonging to every organisation
            on RotaFlow.
          </p>
        </div>

        <main className="p-5 lg:p-6">
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
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col overflow-y-auto border-r border-surface-border bg-surface py-5 dark:border-surface-border-dark dark:bg-surface-dark"
          >
            <div className="mb-6 flex items-start justify-between gap-2 pr-3">
              <ConsoleIdentity />
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Close platform navigation"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-content-muted hover:bg-surface-subtle dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Platform administration" className="flex-1 space-y-1 px-3">
              <NavList items={items} onNavigate={closeDrawer} />
            </nav>
            <ConsoleFooter onNavigate={closeDrawer} />
          </div>
        </div>
      )}
    </div>
  );
}
