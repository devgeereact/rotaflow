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
  Plug,
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
 * Lives in `lib` rather than beside the component so `navigationTargets.test`
 * can check every target against the real route table without importing a
 * React tree — and so exporting it does not cost the component fast refresh.
 *
 * ## Order and labels
 *
 * NEW_STRUCTURE §4's list, verbatim and in its order: Dashboard, Rota Builder,
 * Schedule, Team, Availability, Leave, Swaps, Timesheets, Clock In, Reports,
 * Announcements, Locations, Settings, Integrations.
 *
 * Two earlier deviations are now resolved in the spec's favour. **Team** had
 * been folded into Settings → Permissions on the reasoning that invite/revoke
 * is administration and the designs showed no Team entry; §10 and §34 are
 * explicit that `/app/team` is the workforce directory, so it is top-level
 * again and the directory moved to that URL. **Integrations** had been demoted
 * to a Settings tab; §4 lists it in the sidebar, so it appears in both places
 * and points at the same tab.
 *
 * ## Why Clock In is shown to managers too
 *
 * The obvious reading of the mockups is "staff only" — they are all signed in
 * as Sarah Manager. It is wrong for this product, because of how the risk is
 * shaped: in a small care home the owner and the manager are usually *on the
 * rota themselves*. Hiding the control costs a working manager the thing they
 * open twice a day and gives them no way to find it; showing it to a manager
 * who never clocks in costs one row of nav they can ignore.
 *
 * Gating on "has a staff_profile" would be more precise, but the sidebar has
 * no such query and adding one to render navigation is a poor trade for a row.
 *
 * Staff see the subset §2 grants them, with Settings replaced by My Profile —
 * `settingsTabsForRole('staff')` is empty, so a Settings link would land them
 * on a redirect every time.
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

  if (isManager) {
    items.push({ label: 'Team', icon: Users, to: '/app/team' });
  }

  items.push(
    { label: 'Availability', icon: Clock3, to: '/app/availability' },
    { label: 'Leave', icon: Umbrella, to: '/app/leave' },
    { label: 'Swaps', icon: Repeat2, to: '/app/swaps' },
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
      { label: 'Integrations', icon: Plug, to: '/app/settings/integrations' },
    );
  } else {
    items.push({ label: 'My Profile', icon: UserCircle, to: '/app/account' });
  }

  return items;
}
