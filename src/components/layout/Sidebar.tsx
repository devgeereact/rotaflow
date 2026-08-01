import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  CalendarDays,
  CalendarRange,
  Users,
  MapPin,
  Clock3,
  LogIn,
  Umbrella,
  Repeat2,
  Timer,
  Megaphone,
  BarChart3,
  Settings,
  UserCircle,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOrg } from '@/hooks/useOrg';
import type { MembershipRole } from '@/types';
import logo from '@/assets/logo.png';

interface NavItem {
  label: string;
  icon: LucideIcon;
  to?: string; // omitted = not built yet, rendered disabled
}

/**
 * The sidebar, resolved against the signed-in role.
 *
 * ## Why this stopped being a flat constant
 *
 * The built sidebar had fifteen items against the designs' twelve, and the
 * three extras were not arbitrary:
 *
 * - **Integrations** was top-level; every reference screen shows it as a
 *   Settings tab. It moved, and `/app/integrations` redirects.
 * - **Team** was top-level and the designs have no such entry. What it does —
 *   invite and revoke — is organisation administration, so it folded into
 *   Settings → Permissions, filling a designed tab that had no content.
 * - **Clock in** is absent from every mockup, but the mockups are a *manager's*
 *   view (they are all signed in as Sarah Manager). Clock-in is the single
 *   most-used screen a carer has — twice a day, often on a phone on ward wifi
 *   — and burying it to match a manager-view mockup would be a real usability
 *   loss for the majority of users. So it is role-conditional rather than
 *   removed.
 *
 * Net: a manager sees the designed twelve. A staff member sees the eight that
 * concern them, plus Clock in, and Settings is replaced by My Profile —
 * `settingsTabsForRole('staff')` is empty, so a Settings link would land them
 * on a redirect every time.
 */
function navItemsForRole(role: MembershipRole | null): NavItem[] {
  const isManager = role === 'owner' || role === 'manager';

  const items: NavItem[] = [
    { label: 'Dashboard', icon: LayoutDashboard, to: '/app/dashboard' },
  ];

  if (isManager) {
    items.push({ label: 'Rota', icon: CalendarDays, to: '/app/rota' });
  }

  items.push({ label: 'Schedule', icon: CalendarRange, to: '/app/schedule' });

  if (!isManager) {
    items.push({ label: 'Clock in', icon: LogIn, to: '/app/clock' });
  }

  if (isManager) {
    items.push(
      { label: 'Staff', icon: Users, to: '/app/staff' },
      { label: 'Locations', icon: MapPin, to: '/app/locations' },
    );
  }

  items.push(
    { label: 'Availability', icon: Clock3, to: '/app/availability' },
    { label: 'Leave', icon: Umbrella, to: '/app/leave' },
    { label: 'Swaps', icon: Repeat2, to: '/app/swaps' },
    { label: 'Timesheets', icon: Timer, to: '/app/timesheets' },
    { label: 'Announcements', icon: Megaphone, to: '/app/announcements' },
  );

  if (isManager) {
    items.push(
      { label: 'Reports', icon: BarChart3, to: '/app/reports' },
      { label: 'Settings', icon: Settings, to: '/app/settings' },
    );
  } else {
    items.push({ label: 'My Profile', icon: UserCircle, to: '/app/account' });
  }

  return items;
}

const LINK_BASE =
  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors';
const LINK_INACTIVE =
  'text-content-muted hover:bg-surface hover:text-content dark:text-content-muted-dark dark:hover:bg-surface-dark dark:hover:text-content-dark';
// Soft-tint highlight, not the old white-pill/left-border treatment — same
// bg-X/10 text-X idiom already used for status badges elsewhere in the app
// (e.g. AvailabilityPage, LeavePage), so the active nav item reads as "this
// app's highlight colour", not a one-off style.
const LINK_ACTIVE = 'bg-primary/10 text-primary dark:bg-primary/15';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function NavList({
  items,
  onNavigate,
}: {
  items: NavItem[];
  onNavigate?: () => void;
}): JSX.Element {
  return (
    <nav className="flex-1 space-y-1 px-3">
      {items.map(({ label, icon: Icon, to }) =>
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
  const { role } = useOrg();
  const items = navItemsForRole(role);
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
        <NavList items={items} />
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
            <NavList items={items} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
