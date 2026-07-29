import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  MapPin,
  Clock3,
  Umbrella,
  Repeat2,
  Timer,
  Megaphone,
  BarChart3,
  Settings,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo.png';

interface NavItem {
  label: string;
  icon: LucideIcon;
  to?: string; // omitted = not built yet, rendered disabled
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/app/dashboard' },
  { label: 'Rota', icon: CalendarDays, to: '/app/rota' },
  { label: 'Staff', icon: Users, to: '/app/staff' },
  { label: 'Locations', icon: MapPin, to: '/app/locations' },
  { label: 'Availability', icon: Clock3 },
  { label: 'Leave', icon: Umbrella },
  { label: 'Swaps', icon: Repeat2 },
  { label: 'Timesheets', icon: Timer },
  { label: 'Announcements', icon: Megaphone },
  { label: 'Reports', icon: BarChart3 },
  { label: 'Settings', icon: Settings },
];

const LINK_BASE =
  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors';
const LINK_INACTIVE =
  'text-content-muted hover:bg-surface hover:text-content dark:text-content-muted-dark dark:hover:bg-surface-dark dark:hover:text-content-dark';
const LINK_ACTIVE =
  'border-l-2 border-primary bg-surface text-primary dark:bg-surface-dark';

function NavList({ onNavigate }: { onNavigate?: () => void }): JSX.Element {
  return (
    <nav className="flex-1 space-y-1 px-3">
      {NAV_ITEMS.map(({ label, icon: Icon, to }) =>
        to ? (
          <NavLink
            key={label}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(LINK_BASE, isActive ? LINK_ACTIVE : LINK_INACTIVE)
            }
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </NavLink>
        ) : (
          <div
            key={label}
            aria-disabled="true"
            className={cn(
              LINK_BASE,
              'cursor-not-allowed justify-between text-content-muted/60 dark:text-content-muted-dark/60',
            )}
          >
            <span className="flex items-center gap-3">
              <Icon size={18} aria-hidden="true" />
              {label}
            </span>
            <span className="text-xs">Soon</span>
          </div>
        ),
      )}
    </nav>
  );
}

/** Fixed left navigation for the /app/* tenant shell. Only routed items are real links. */
export function Sidebar(): JSX.Element {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={mobileOpen}
        className="fixed left-3 top-3 z-40 rounded-lg border border-surface-border bg-surface p-2 text-content shadow-sm dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark md:hidden"
      >
        <Menu size={20} aria-hidden="true" />
      </button>

      <aside className="hidden w-64 shrink-0 flex-col border-r border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark md:flex">
        <div className="flex items-center gap-2 px-5 py-6">
          <img src={logo} alt="" className="h-8 w-8" />
          <span className="font-display text-lg font-bold text-content dark:text-content-dark">
            Rota<span className="text-primary">Flow</span>
          </span>
        </div>
        <NavList />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="fixed inset-0 cursor-default bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-10 flex w-64 flex-col border-r border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
            <div className="flex items-center justify-between gap-2 px-5 py-6">
              <div className="flex items-center gap-2">
                <img src={logo} alt="" className="h-8 w-8" />
                <span className="font-display text-lg font-bold text-content dark:text-content-dark">
                  Rota<span className="text-primary">Flow</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation menu"
                className="rounded-lg p-1 text-content-muted hover:bg-surface dark:text-content-muted-dark"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <NavList onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
