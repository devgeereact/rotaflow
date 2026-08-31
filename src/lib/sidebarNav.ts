import {
  CalendarPlus,
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
  TimerReset,
  Megaphone,
  BarChart3,
  Settings,
  UserCircle,
  LifeBuoy,
  type LucideIcon,
} from 'lucide-react';
import type { MembershipRole } from '@/types';

export interface NavItem {
  label: string;
  icon: LucideIcon;
  /**
   * Required, deliberately.
   *
   * This was optional, and an item without it rendered greyed out with a
   * "Soon" chip. Every item has had a real route since #75, so the branch was
   * dead, but leaving the field optional keeps the door open to shipping a
   * navigation item that goes nowhere, which is the one thing a sidebar must
   * never do. Making it required means a future unrouted entry is a
   * typecheck failure rather than a chip a user clicks twice and gives up on.
   */
  to: string;
  /** Which live count, if any, decorates this row. See `useNavBadges`. */
  badge?: 'leave' | 'swaps';
}

/**
 * The primary sidebar, resolved against the signed-in role.
 *
 * Lives in `lib` rather than beside the component so `navigationTargets.test`
 * can check every target against the real route table without importing a
 * React tree, and so exporting it does not cost the component fast refresh.
 *
 * ## Order and labels: `docs/ORGANISATION_WORKSPACE.html`
 *
 * Dashboard, Rota Builder, Schedule, Clock in, Timesheets, Availability,
 * Leave, Shift Swaps, Overtime, Team, Locations, Announcements, Reports.
 *
 * **Rota Builder and Schedule are separate rows again**, and so are **Team
 * and Availability**. An earlier pass merged each pair into one destination
 * with an in-page tab bar (`workspaceTabs.ts`) on the reasoning that building
 * a week and reading the published one were "one workspace, two halves". The
 * organisation workspace reference treats them as two separate journeys with
 * their own sidebar rows instead (a manager builds the rota far more often
 * than they read the read-only view of it, and burying "Schedule" a click
 * inside "Rota" cost it a place a keyboard-driven user could jump straight
 * to). Rota Builder and Schedule dropped the cross-link entirely, matching
 * the reference's own nav (two rows, no shared tab bar); Team and Availability
 * keep theirs, since `workspaceTabs.ts`'s `teamWorkspaceTabs` is still wired
 * into both pages.
 *
 * ## Why Clock In is shown to managers too
 *
 * The obvious reading of the mockups is "staff only". They are all signed in
 * as Sarah Manager. It is wrong for this product, because of how the risk is
 * shaped: in a small care home the owner and the manager are usually *on the
 * rota themselves*. Hiding the control costs a working manager the thing they
 * open twice a day and gives them no way to find it; showing it to a manager
 * who never clocks in costs one row of nav they can ignore.
 *
 * Gating on "has a staff_profile" would be more precise, but the sidebar has
 * no such query and adding one to render navigation is a poor trade for a row.
 */
export function navItemsForRole(role: MembershipRole | null): NavItem[] {
  const isManager = role === 'owner' || role === 'manager';

  const items: NavItem[] = [
    { label: 'Dashboard', icon: LayoutDashboard, to: '/app/dashboard' },
  ];

  if (isManager) {
    items.push({ label: 'Rota Builder', icon: CalendarDays, to: '/app/rota' });
  }
  items.push({ label: 'Schedule', icon: CalendarRange, to: '/app/schedule' });
  items.push({ label: 'Clock In', icon: LogIn, to: '/app/clock' });
  items.push({ label: 'Timesheets', icon: Timer, to: '/app/timesheets' });
  items.push({ label: 'Availability', icon: Clock3, to: '/app/availability' });
  items.push({ label: 'Leave', icon: Umbrella, to: '/app/leave', badge: 'leave' });
  items.push({ label: 'Shift Swaps', icon: Repeat2, to: '/app/swaps', badge: 'swaps' });
  // Everybody, manager included. A manager who works shifts covers gaps too,
  // and the board is empty for anyone with nothing to take.
  items.push({ label: 'Open Shifts', icon: CalendarPlus, to: '/app/open-shifts' });
  // §2 lists "Request overtime" among what a staff member can do, so this
  // sits outside the managerial block. The page's own Team toggle is what
  // gates the approval queue.
  items.push({ label: 'Overtime', icon: TimerReset, to: '/app/overtime' });

  if (isManager) {
    items.push({ label: 'Team', icon: Users, to: '/app/team' });
    items.push({ label: 'Locations', icon: MapPin, to: '/app/locations' });
  }

  items.push({ label: 'Announcements', icon: Megaphone, to: '/app/announcements' });

  if (isManager) {
    items.push({ label: 'Reports', icon: BarChart3, to: '/app/reports' });
  }

  return items;
}

/**
 * The rail's second, quieter nav group: account-level destinations rather
 * than workspace ones. A manager gets Settings; staff get My Profile in the
 * same slot, `settingsTabsForRole('staff')` is empty, so a Settings link
 * would land them on a redirect every time. Help & Support is common to both.
 */
export function footerNavItemsForRole(role: MembershipRole | null): NavItem[] {
  const isManager = role === 'owner' || role === 'manager';

  return [
    isManager
      ? { label: 'Settings', icon: Settings, to: '/app/settings' }
      : { label: 'My Profile', icon: UserCircle, to: '/app/account' },
    { label: 'Help & Support', icon: LifeBuoy, to: '/app/help' },
  ];
}
