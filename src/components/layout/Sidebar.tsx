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

/** Fixed left navigation for the /app/* tenant shell. Only routed items are real links. */
export function Sidebar(): JSX.Element {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark md:flex">
      <div className="flex items-center gap-2 px-5 py-6">
        <img src={logo} alt="" className="h-8 w-8" />
        <span className="font-display text-lg font-bold text-content dark:text-content-dark">
          Rota<span className="text-primary">Flow</span>
        </span>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.map(({ label, icon: Icon, to }) =>
          to ? (
            <NavLink
              key={label}
              to={to}
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
    </aside>
  );
}
