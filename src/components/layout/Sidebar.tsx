import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  CalendarDays,
  CalendarRange,
  Users,
  UserPlus,
  MapPin,
  Clock3,
  LogIn,
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
  { label: 'Schedule', icon: CalendarRange, to: '/app/schedule' },
  { label: 'Clock in', icon: LogIn, to: '/app/clock' },
  { label: 'Staff', icon: Users, to: '/app/staff' },
  { label: 'Team', icon: UserPlus, to: '/app/team' },
  { label: 'Locations', icon: MapPin, to: '/app/locations' },
  { label: 'Availability', icon: Clock3, to: '/app/availability' },
  { label: 'Leave', icon: Umbrella, to: '/app/leave' },
  { label: 'Swaps', icon: Repeat2, to: '/app/swaps' },
  { label: 'Timesheets', icon: Timer, to: '/app/timesheets' },
  { label: 'Announcements', icon: Megaphone, to: '/app/announcements' },
  { label: 'Reports', icon: BarChart3 },
  { label: 'Settings', icon: Settings },
];

const LINK_BASE =
  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors';
const LINK_INACTIVE =
  'text-content-muted hover:bg-surface hover:text-content dark:text-content-muted-dark dark:hover:bg-surface-dark dark:hover:text-content-dark';
const LINK_ACTIVE =
  'border-l-2 border-primary bg-surface text-primary dark:bg-surface-dark';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
            tabIndex={-1}
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
  const drawerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mobileOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    const focusable = drawer?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable?.[0] ?? drawer)?.focus();

    const appContent = document.querySelector('main');
    if (appContent) appContent.setAttribute('aria-hidden', 'true');

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
        return;
      }
      if (e.key !== 'Tab' || !drawer) return;

      const focusableEls = Array.from(
        drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusableEls.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusableEls[0]!;
      const last = focusableEls[focusableEls.length - 1]!;
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
      if (appContent) appContent.removeAttribute('aria-hidden');
      previouslyFocused?.focus();
    };
  }, [mobileOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={mobileOpen}
        tabIndex={mobileOpen ? -1 : 0}
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
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            tabIndex={-1}
            className="relative z-10 flex w-64 flex-col border-r border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark"
          >
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
