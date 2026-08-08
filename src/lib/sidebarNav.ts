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
  TimerReset,
  Megaphone,
  BarChart3,
  Settings,
  UserCircle,
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
  /** Which count from `useNavBadgeCounts` this row shows, if any. */
  badgeKey?: 'leave' | 'swaps';
}

/**
 * The sidebar, resolved against the signed-in role.
 *
 * Lives in `lib` rather than beside the component so `navigationTargets.test`
 * can check every target against the real route table without importing a
 * React tree, and so exporting it does not cost the component fast refresh.
 *
 * ## Order and labels
 *
 * NEW_STRUCTURE §4's list, verbatim and in its order: Dashboard, Rota Builder,
 * Schedule, Team, Availability, Leave, Swaps, Timesheets, Clock In, Reports,
 * Announcements, Locations, Settings, Integrations.
 *
 * **Team** had been folded into Settings → Permissions on the reasoning that
 * invite/revoke is administration and the designs showed no Team entry; §10 and
 * §34 are explicit that `/app/team` is the workforce directory, so it is
 * top-level again and the directory moved to that URL.
 *
 * **Integrations is deliberately NOT here**, against §4's list. It briefly
 * appeared in both the sidebar and the Settings tab bar, pointing at the same
 * `/app/settings/integrations` route, so the identical destination had two
 * entries in the navigation, and the sidebar row lit up as "active" while the
 * Settings tab bar simultaneously showed you were inside Settings. One
 * destination, one home: it is a Settings tab, which is also where every
 * reference screen puts it.
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
 *
 * Staff see the subset §2 grants them, with Settings replaced by My Profile,
 * `settingsTabsForRole('staff')` is empty, so a Settings link would land them
 * on a redirect every time.
 */
export function navItemsForRole(role: MembershipRole | null): NavItem[] {
  const isManager = role === 'owner' || role === 'manager';

  const items: NavItem[] = [
    { label: 'Dashboard', icon: LayoutDashboard, to: '/app/dashboard' },
  ];

  /*
   * Two merged workspaces, one entry each.
   *
   * **Rota** was "Rota Builder" + "Schedule": building a week and reading the
   * published result, with no way across but the sidebar. **Team** was "Team" +
   * "Availability": who works here, and when they can work. Each pair is now
   * one destination with section tabs (see `workspaceTabs.ts`), which is four
   * sidebar rows collapsed into two without losing a screen.
   *
   * A manager lands on the half they act on. The builder, the directory. Staff
   * cannot open either of those, so their entry points straight at the half
   * they can use and the tab bar does not render at all.
   */
  items.push(
    isManager
      ? { label: 'Rota', icon: CalendarDays, to: '/app/rota' }
      : { label: 'Schedule', icon: CalendarRange, to: '/app/schedule' },
    isManager
      ? { label: 'Team', icon: Users, to: '/app/team' }
      : { label: 'Availability', icon: Clock3, to: '/app/availability' },
  );

  items.push(
    { label: 'Leave', icon: Umbrella, to: '/app/leave', badgeKey: 'leave' },
    { label: 'Swaps', icon: Repeat2, to: '/app/swaps', badgeKey: 'swaps' },
    // §2 lists "Request overtime" among what a staff member can do, so this
    // sits outside the managerial block. The page's own Team toggle is what
    // gates the approval queue.
    { label: 'Overtime', icon: TimerReset, to: '/app/overtime' },
    { label: 'Timesheets', icon: Timer, to: '/app/timesheets' },
    { label: 'Clock In', icon: LogIn, to: '/app/clock' },
  );

  if (isManager) {
    items.push({ label: 'Reports', icon: BarChart3, to: '/app/reports' });
  }

  items.push({ label: 'Announcements', icon: Megaphone, to: '/app/announcements' });

  if (isManager) {
    items.push(
      { label: 'Locations', icon: MapPin, to: '/app/locations' },
      { label: 'Settings', icon: Settings, to: '/app/settings' },
    );
  } else {
    items.push({ label: 'My Profile', icon: UserCircle, to: '/app/account' });
  }

  return items;
}
