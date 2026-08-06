import { NavLink } from 'react-router-dom';
import {
  CalendarRange,
  LayoutDashboard,
  LogIn,
  MoreHorizontal,
  Umbrella,
  type LucideIcon,
} from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { cn } from '@/lib/utils';

interface TabItem {
  label: string;
  icon: LucideIcon;
  to: string;
  /** `end` so a parent route does not stay highlighted on every child. */
  end?: boolean;
}

/**
 * Bottom tab bar, phones only.
 *
 * ## Why a phone gets a different navigation, not a smaller one
 *
 * The drawer is fine for the full eleven-item nav, but it costs a tap to open
 * before you can do anything. The things a staff member opens on a phone are a
 * short, predictable list. What am I working, clock in, book time off, and
 * those should be one thumb-reach away, which is what this is for.
 *
 * The drawer stays: `More` opens it, so nothing is unreachable and the tab bar
 * does not have to grow every time a screen is added.
 *
 * ## Why the same five for managers
 *
 * A manager on a phone is not building a rota on a 6-inch screen; they are
 * checking cover or approving a request between other things. Rota building,
 * reports and settings stay behind `More` for everyone, which keeps the bar
 * stable rather than shifting under a user whose role changes.
 */
/*
 * NEW_STRUCTURE §22's five: Home, Schedule, Clock In, Requests, More.
 * "Requests" lands on Leave because that screen is the requests hub. It holds
 * the leave queue and links the swap queue beside it, so the label describes
 * where it goes rather than overpromising a screen that does not exist.
 */
const TABS: readonly TabItem[] = [
  { label: 'Home', icon: LayoutDashboard, to: '/app/dashboard' },
  { label: 'Schedule', icon: CalendarRange, to: '/app/schedule' },
  { label: 'Clock In', icon: LogIn, to: '/app/clock' },
  { label: 'Requests', icon: Umbrella, to: '/app/leave' },
] as const;

interface MobileTabBarProps {
  /** Opens the navigation drawer. The `More` tab. */
  onOpenMore: () => void;
}

export function MobileTabBar({ onOpenMore }: MobileTabBarProps): JSX.Element | null {
  const { role } = useOrg();

  // No role means no membership resolved yet; AppShell is showing boot state.
  if (role === null) return null;

  return (
    <nav
      aria-label="Primary"
      // `pb-[env(safe-area-inset-bottom)]` keeps the row clear of the home
      // indicator on a notched iPhone, where the bottom ~34px is not tappable.
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-surface-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden dark:border-surface-border-dark dark:bg-surface-dark"
    >
      {TABS.map(({ label, icon: Icon, to }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              // 56px tall plus the safe-area inset clears the 44px touch
              // minimum with room for the label.
              'flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
              isActive
                ? 'text-primary'
                : 'text-content-muted dark:text-content-muted-dark',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={20} aria-hidden="true" strokeWidth={isActive ? 2.4 : 2} />
              {label}
            </>
          )}
        </NavLink>
      ))}

      <button
        type="button"
        onClick={onOpenMore}
        aria-label="More navigation"
        className="flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-content-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary dark:text-content-muted-dark"
      >
        <MoreHorizontal size={20} aria-hidden="true" />
        More
      </button>
    </nav>
  );
}
