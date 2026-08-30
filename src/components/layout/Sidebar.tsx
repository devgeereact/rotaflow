import { useCallback, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOrg } from '@/hooks/useOrg';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useNavBadgeCounts } from '@/hooks/useNavBadgeCounts';
import { SidebarOrgSwitcher } from '@/components/layout/SidebarOrgSwitcher';
import { SidebarFooter } from '@/components/layout/SidebarFooter';
import { GlobalSearch } from '@/components/layout/GlobalSearch';
import { navItemsForRole, type NavItem } from '@/lib/sidebarNav';
import { BrandMark } from '@/components/ui/BrandMark';
import { BRAND } from '@/lib/brand';

const LINK_BASE =
  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors';
const LINK_INACTIVE =
  'text-content-muted hover:bg-primary-wash hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark';
// Solid fill, not the earlier soft-tint idiom (`bg-primary/10 text-primary dark:text-primary-ink-dark`):
// see docs/DESIGN.md §6, "Sidebar nav, active item" for the 2026-08-06 change
// against `docs/ORGANISATION_WORKSPACE.html`.
const LINK_ACTIVE = 'bg-primary text-primary-fg';

function NavList({
  items,
  badges,
  collapsed = false,
  onNavigate,
}: {
  items: NavItem[];
  badges: { leave: number; swaps: number };
  collapsed?: boolean;
  onNavigate?: () => void;
}): JSX.Element {
  return (
    <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-3">
      {items.map(({ label, icon: Icon, to, badge }) => {
        const count = badge ? badges[badge] : 0;
        return (
          <NavLink
            key={label}
            to={to}
            onClick={onNavigate}
            // `title` is the tooltip when collapsed. The label also stays in
            // the accessibility tree via `sr-only` rather than being dropped, // a collapsed sidebar of eleven unlabelled icons is unusable with
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
            {({ isActive }) => (
              <>
                <Icon size={18} aria-hidden="true" className="shrink-0" />
                {collapsed ? (
                  <span className="sr-only">{label}</span>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                )}
                {!collapsed && count > 0 && (
                  <span
                    className={cn(
                      'ml-auto shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none',
                      isActive
                        ? 'bg-white/25 text-primary-fg'
                        : 'bg-warning text-[#3A2A08]',
                    )}
                  >
                    {count}
                  </span>
                )}
              </>
            )}
          </NavLink>
        );
      })}
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
  const { role, orgId } = useOrg();
  const items = navItemsForRole(role);
  const badges = useNavBadgeCounts(orgId);
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

  // Extracted to `useFocusTrap` so the platform console's drawer runs the same
  // code rather than a second, subtly different copy of it.
  const closeDrawer = useCallback(() => setMobileOpen(false), [setMobileOpen]);
  useFocusTrap(drawerRef, mobileOpen, closeDrawer);

  return (
    <>
      {/*
        The floating hamburger is gone. It sat `fixed left-3 top-3` over the
        page content on every mobile screen, and the bottom tab bar's `More`
        now opens this same drawer from a place a thumb already is. One opener,
        no button parked on top of the content.
      */}
      {/*
        `h-full` against AppShell's viewport-height row, so the sidebar is
        pinned and never scrolls with the page. If the nav list outgrows the
        space, `NavList`'s own `overflow-y-auto` scrolls just the links. The
        logo, organisation switcher and profile footer stay put, which is the
        point of pinning it at all.
      */}
      <aside
        className={cn(
          'hidden h-full shrink-0 flex-col border-r border-surface-border bg-surface-subtle transition-[width] duration-200 md:flex',
          'dark:border-surface-border-dark dark:bg-surface-subtle-dark',
          collapsed ? 'w-[4.5rem]' : 'w-64',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2 px-5 py-6',
            collapsed ? 'flex-col justify-center px-0' : 'justify-between',
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <BrandMark label={null} className="h-8 w-8 shrink-0" />
            {!collapsed && (
              <span className="min-w-0">
                <span className="block font-display text-lg font-bold leading-tight text-content dark:text-content-dark">
                  Rota
                  <span className="text-primary dark:text-primary-ink-dark">Flow</span>
                </span>
                <span className="block text-[10.5px] leading-tight text-content-muted dark:text-content-muted-dark">
                  {BRAND.tagline}
                </span>
              </span>
            )}
          </div>
          {/*
            Lives here, not at the bottom of the footer stack, so it's reachable
            without scrolling past every row below it — the one control on this
            rail someone reaches for on nearly every session.
          */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="shrink-0 rounded-lg p-1.5 text-content-muted transition-colors hover:bg-primary-wash hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark"
          >
            {collapsed ? (
              <PanelLeftOpen size={18} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={18} aria-hidden="true" />
            )}
          </button>
        </div>

        <SidebarOrgSwitcher collapsed={collapsed} />
        {!collapsed && (
          <div className="px-3 pb-2">
            <GlobalSearch variant="rail" />
          </div>
        )}
        <NavList items={items} badges={badges} collapsed={collapsed} />
        <SidebarFooter collapsed={collapsed} />
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
                <BrandMark label={null} className="h-8 w-8" />
                <span>
                  <span className="block font-display text-lg font-bold leading-tight text-content dark:text-content-dark">
                    Rota
                    <span className="text-primary dark:text-primary-ink-dark">Flow</span>
                  </span>
                  <span className="block text-[10.5px] leading-tight text-content-muted dark:text-content-muted-dark">
                    {BRAND.tagline}
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
            <div className="px-3 pb-2">
              <GlobalSearch variant="rail" onNavigate={() => setMobileOpen(false)} />
            </div>
            <NavList
              items={items}
              badges={badges}
              onNavigate={() => setMobileOpen(false)}
            />
            <SidebarFooter collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
