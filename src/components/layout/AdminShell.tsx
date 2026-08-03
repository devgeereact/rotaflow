import { Link, NavLink, Outlet } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ADMIN_NAV } from '@/lib/adminNav';

const LINK_BASE =
  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors';

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
 */
export function AdminShell(): JSX.Element {
  return (
    <div className="flex min-h-screen bg-surface-subtle dark:bg-surface-subtle-dark">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-surface-border bg-surface py-5 md:flex dark:border-surface-border-dark dark:bg-surface-dark">
        <div className="mb-6 px-5">
          <p className="flex items-center gap-2 font-display text-lg font-bold text-content dark:text-content-dark">
            <ShieldCheck size={20} className="text-danger" aria-hidden="true" />
            RotaFlow
          </p>
          <p className="mt-0.5 text-[0.7rem] font-semibold uppercase tracking-wider text-danger">
            Platform administration
          </p>
        </div>

        <nav aria-label="Platform administration" className="flex-1 space-y-1 px-3">
          {ADMIN_NAV.map(({ label, icon: Icon, to, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  LINK_BASE,
                  isActive
                    ? 'bg-danger/10 text-danger'
                    : 'text-content-muted hover:bg-surface-subtle hover:text-content dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark dark:hover:text-content-dark',
                )
              }
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-6 px-3">
          <Link
            to="/app/dashboard"
            className={cn(
              LINK_BASE,
              'text-content-muted hover:bg-surface-subtle hover:text-content dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark dark:hover:text-content-dark',
            )}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            Back to my organisation
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Standing reminder of whose data is on screen. It is a banner rather
            than a one-time toast because the risk — acting on a customer's
            live data believing it is your own — lasts as long as the session
            does. On mobile this doubles as the only nav affordance, so the
            links live inside it rather than in a drawer that could be missed. */}
        <div className="border-b border-danger/20 bg-danger/5 px-5 py-2.5">
          <p className="text-xs font-medium text-danger">
            Platform administration — you are viewing data belonging to every organisation
            on RotaFlow.
          </p>
          <nav
            aria-label="Platform administration"
            className="mt-2 flex flex-wrap gap-x-4 gap-y-1 md:hidden"
          >
            {ADMIN_NAV.map(({ label, to, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'text-xs font-medium',
                    isActive
                      ? 'text-danger underline'
                      : 'text-content-muted dark:text-content-muted-dark',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>

        <main className="p-5 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
