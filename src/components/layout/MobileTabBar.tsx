import { NavLink } from 'react-router-dom';
import {
  CalendarRange,
  LayoutDashboard,
  LogIn,
  MoreHorizontal,
  ScanFace,
  Umbrella,
  type LucideIcon,
} from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useWorkMode } from '@/hooks/useWorkMode';
import { cn } from '@/lib/utils';
import type { WorkMode } from '@/lib/workMode';
import type { MembershipRole } from '@/types';

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
/**
 * The four fixed tabs. The third one differs by what the person is here to
 * do, which is resolved in `tabsFor` below.
 */
const HOME: TabItem = { label: 'Home', icon: LayoutDashboard, to: '/app/dashboard' };
const SCHEDULE: TabItem = {
  label: 'Schedule',
  icon: CalendarRange,
  to: '/app/schedule',
};
const REQUESTS: TabItem = { label: 'Requests', icon: Umbrella, to: '/app/leave' };

/**
 * The third tab: a punch clock or an attendance board.
 *
 * A manager on a phone is checking who turned up, not clocking themselves in
 * — and an owner with no staff record could not clock in at all, so the tab
 * they were given opened an empty screen. The personal one comes back the
 * moment they turn My work on.
 */
function tabsFor(role: MembershipRole, mode: WorkMode): TabItem[] {
  const managerial = role === 'owner' || role === 'manager';
  const third: TabItem =
    managerial && mode === 'management'
      ? { label: 'Attendance', icon: ScanFace, to: '/app/attendance' }
      : { label: 'Clock In', icon: LogIn, to: '/app/clock' };
  return [HOME, SCHEDULE, third, REQUESTS];
}

interface MobileTabBarProps {
  /** Opens the navigation drawer. The `More` tab. */
  onOpenMore: () => void;
}

export function MobileTabBar({ onOpenMore }: MobileTabBarProps): JSX.Element | null {
  const { role } = useOrg();
  const { mode } = useWorkMode();

  // No role means no membership resolved yet; AppShell is showing boot state.
  if (role === null) return null;

  const tabs = tabsFor(role, mode);

  return (
    <nav
      aria-label="Primary"
      // `pb-[env(safe-area-inset-bottom)]` keeps the row clear of the home
      // indicator on a notched iPhone, where the bottom ~34px is not tappable.
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-surface-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden dark:border-surface-border-dark dark:bg-surface-dark"
    >
      {tabs.map(({ label, icon: Icon, to }) => (
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
                ? 'text-primary dark:text-primary-ink-dark'
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
