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
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOrg } from '@/hooks/useOrg';
import { SidebarOrgSwitcher } from '@/components/layout/SidebarOrgSwitcher';
import { SidebarFooter } from '@/components/layout/SidebarFooter';
import type { MembershipRole } from '@/types';
import logo from '@/assets/logo.png';

interface NavItem {
  label: string;
  icon: LucideIcon;
  /**
   * Required, deliberately.
   *
   * This was optional, and an item without it rendered greyed out with a
   * "Soon" chip. Every item has had a real route since #75, so the branch was
   * dead — but leaving the field optional keeps the door open to shipping a
   * navigation item that goes nowhere, which is the one thing a sidebar must
   * never do. Making it required means a future unrouted entry is a
   * typecheck failure rather than a chip a user clicks twice and gives up on.
   */
  to: string;
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
 *   view — they are all signed in as Sarah Manager. Clock-in is the single
 *   most-used screen a carer has: twice a day, usually on a phone on ward
 *   wifi. Burying it to match a manager-view mockup would be a real usability
 *   loss for most of the user base.
 *
 * ## Why Clock in is shown to managers too, and not made role-conditional
 *
 * The obvious reading of the mockups is "staff only", and that is what
 * audit01 §7c recommended. It is wrong for this product, because of how the
 * risk is shaped: in a small care home the owner and the manager are usually
 * *on the rota themselves*. Hiding the control costs a working manager the
 * thing they open twice a day and gives them no way to find it; showing it to
 * a manager who never clocks in costs one row of nav they can ignore.
 *
 * That asymmetry decides it. Gating on "has a staff_profile" would be more
 * precise, but the sidebar has no such query and adding one to render
 * navigation is a poor trade for a row.
 *
 * Net: a manager sees the designed twelve plus Clock in; a staff member sees
 * the nine that concern them, with Settings replaced by My Profile —
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

  items.push(
    { label: 'Schedule', icon: CalendarRange, to: '/app/schedule' },
    { label: 'Clock in', icon: LogIn, to: '/app/clock' },
  );

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
  collapsed = false,
  onNavigate,
}: {
  items: NavItem[];
  collapsed?: boolean;
  onNavigate?: () => void;
}): JSX.Element {
  return (
    <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto px-3">
      {items.map(({ label, icon: Icon, to }) => (
        <NavLink
          key={label}
          to={to}
          onClick={onNavigate}
          // `title` is the tooltip when collapsed. The label also stays in
          // the accessibility tree via `sr-only` rather than being dropped —
          // a collapsed sidebar of eleven unlabelled icons is unusable with
          // a screen reader, and `title` alone is not reliably announced.
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            cn(
              LINK_BASE,
              isActive ? LINK_ACTIVE : LINK_INACTIVE,
              collapsed && 'justify-center px-0',
            )
          }
        >
          <Icon size={18} aria-hidden="true" />
          {collapsed ? <span className="sr-only">{label}</span> : label}
        </NavLink>
      ))}
    </nav>
  );
}

const COLLAPSED_STORAGE_KEY = 'rotaflow.sidebar.collapsed';

interface SidebarProps {
  /**
   * Drawer open state, owned by `AppShell`.
   *
   * It used to be local state here, which was fine until the mobile tab bar
   * needed a `More` button that opens this same drawer. Two components each
   * holding their own copy of one panel's open state desyncs the first time
   * either of them closes it, so the shell owns it and both read from there.
   */
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

/** Fixed left navigation for the /app/* tenant shell. Only routed items are real links. */
export function Sidebar({ mobileOpen, onMobileOpenChange }: SidebarProps): JSX.Element {
  const { role } = useOrg();
  const items = navItemsForRole(role);
  const setMobileOpen = onMobileOpenChange;
  const drawerRef = useRef<HTMLDivElement | null>(null);

  // Read once on mount rather than in an effect: restoring the collapsed state
  // after the first paint makes the whole page jump sideways on every load for
  // anyone who collapsed it.
  const [collapsed, setCollapsed] = useState(
    () => window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true',
  );

  const toggleCollapsed = (): void => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
      return next;
    });
  };

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
  }, [mobileOpen, setMobileOpen]);

  return (
    <>
      {/*
        The floating hamburger is gone. It sat `fixed left-3 top-3` over the
        page content on every mobile screen, and the bottom tab bar's `More`
        now opens this same drawer from a place a thumb already is. One opener,
        no button parked on top of the content.
      */}
      <aside
        className={cn(
          'hidden shrink-0 flex-col border-r border-surface-border bg-surface-subtle transition-[width] duration-200 md:flex',
          'dark:border-surface-border-dark dark:bg-surface-subtle-dark',
          collapsed ? 'w-[4.5rem]' : 'w-64',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2 px-5 py-6',
            collapsed && 'justify-center px-0',
          )}
        >
          <img src={logo} alt="" aria-hidden="true" className="h-8 w-8 shrink-0" />
          {!collapsed && (
            <span className="min-w-0">
              <span className="block font-display text-lg font-bold leading-tight text-content dark:text-content-dark">
                Rota<span className="text-primary">Flow</span>
              </span>
              <span className="block text-[10px] font-semibold uppercase tracking-lockup text-content-muted dark:text-content-muted-dark">
                Workforce scheduling
              </span>
            </span>
          )}
        </div>

        <SidebarOrgSwitcher collapsed={collapsed} />
        <NavList items={items} collapsed={collapsed} />
        <SidebarFooter collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
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
                <img src={logo} alt="" aria-hidden="true" className="h-8 w-8" />
                <span>
                  <span className="block font-display text-lg font-bold leading-tight text-content dark:text-content-dark">
                    Rota<span className="text-primary">Flow</span>
                  </span>
                  <span className="block text-[10px] font-semibold uppercase tracking-lockup text-content-muted dark:text-content-muted-dark">
                    Workforce scheduling
                  </span>
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
            {/* The drawer is always full width, so it never renders collapsed. */}
            <SidebarOrgSwitcher collapsed={false} />
            <NavList items={items} onNavigate={() => setMobileOpen(false)} />
            <SidebarFooter collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
