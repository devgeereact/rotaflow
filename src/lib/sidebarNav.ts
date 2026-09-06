import {
  CalendarPlus,
  CheckCheck,
  LayoutDashboard,
  CalendarDays,
  CalendarRange,
  Users,
  MapPin,
  Clock3,
  LogIn,
  ScanFace,
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
import type { WorkMode } from '@/lib/workMode';
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
  /**
   * Marks a row that only exists because the person opted into `my-work`.
   * The rail draws these under a "My work" heading so it is obvious which
   * half of the product a row belongs to.
   */
  group?: 'my-work';
}

export interface NavOptions {
  /** Management or personal. Defaults to management for anyone but staff. */
  mode?: WorkMode;
}

/**
 * The primary sidebar, resolved against the signed-in role and work mode.
 *
 * Lives in `lib` rather than beside the component so `navigationTargets.test`
 * can check every target against the real route table without importing a
 * React tree, and so exporting it does not cost the component fast refresh.
 *
 * ## Order and labels: `docs/ORGANISATION_WORKSPACE.html`
 *
 * Dashboard, Rota Builder, Schedule, Team Attendance, Timesheets, Team
 * Availability, Leave, Shift Swaps, Open Shifts, Overtime, Approvals, Team,
 * Locations, Announcements, Reports.
 *
 * **Rota Builder and Schedule are separate rows**, and so are Team and
 * Availability. An earlier pass merged each pair into one destination with an
 * in-page tab bar (`workspaceTabs.ts`) on the reasoning that building a week
 * and reading the published one were "one workspace, two halves". The
 * organisation workspace reference treats them as two separate journeys with
 * their own sidebar rows instead: a manager builds the rota far more often
 * than they read the read-only view of it, and burying "Schedule" a click
 * inside "Rota" cost it a place a keyboard-driven user could jump straight to.
 *
 * ## Why a manager no longer gets Clock In by default
 *
 * This file used to argue the opposite, and the argument was: "in a small care
 * home the owner and the manager are usually on the rota themselves. Hiding
 * the control costs a working manager the thing they open twice a day."
 *
 * The half that was wrong is that the cost was assumed to fall only on the
 * manager who does work shifts. It fell on everybody. An owner with no staff
 * profile — which is the ordinary case for anybody running more than one site
 * — was given Clock In, a personal Availability editor and a personal
 * timesheet, and every one of them opened on an empty screen, because there
 * was no staff record for any of it to attach to. The comment then dismissed
 * gating on a staff profile as "a poor trade for a row"; it is not a row, it
 * is four screens that cannot work.
 *
 * So: management is the default, `my-work` is opted into, and the opt-in is
 * only offered to somebody who has a staff profile here (`useWorkMode`). A
 * manager who does work shifts keeps everything they had — they start in
 * `my-work` — and nothing managerial is ever removed by the mode. See
 * `src/lib/workMode.ts` for why the two roles default in opposite directions.
 *
 * ## Team Attendance, not Clock In
 *
 * The managerial equivalent of Clock In is not a personal punch clock, it is
 * the review workspace: who actually clocked in, who is late, whose shift
 * ended with the clock still running. `/app/attendance`.
 */
export function navItemsForRole(
  role: MembershipRole | null,
  options: NavOptions = {},
): NavItem[] {
  const isManager = role === 'owner' || role === 'manager';
  const mode: WorkMode = options.mode ?? (role === 'staff' ? 'my-work' : 'management');
  const personal = mode === 'my-work';

  const items: NavItem[] = [
    { label: 'Dashboard', icon: LayoutDashboard, to: '/app/dashboard' },
  ];

  if (isManager) {
    items.push({ label: 'Rota Builder', icon: CalendarDays, to: '/app/rota' });
  }
  items.push({ label: 'Schedule', icon: CalendarRange, to: '/app/schedule' });

  if (isManager) {
    // The management counterpart of Clock In: the attendance record, not a
    // punch clock. It is above Timesheets because a timesheet is what
    // attendance becomes once it has been reviewed.
    items.push({ label: 'Team Attendance', icon: ScanFace, to: '/app/attendance' });
  }

  items.push({ label: 'Timesheets', icon: Timer, to: '/app/timesheets' });
  items.push({
    // A manager opens this to see who is available, with staff and date
    // controls; a staff member opens it to say when they are. Same route,
    // and the page reads the work mode to decide which it is.
    label: isManager && !personal ? 'Team Availability' : 'Availability',
    icon: Clock3,
    to: '/app/availability',
  });
  items.push({ label: 'Leave', icon: Umbrella, to: '/app/leave', badge: 'leave' });
  items.push({ label: 'Shift Swaps', icon: Repeat2, to: '/app/swaps', badge: 'swaps' });
  items.push({ label: 'Open Shifts', icon: CalendarPlus, to: '/app/open-shifts' });
  items.push({ label: 'Overtime', icon: TimerReset, to: '/app/overtime' });

  if (isManager) {
    // Above Team, because it is the thing a manager opens first: the queue is
    // the product's answer to "is anybody waiting on me".
    items.push({ label: 'Approvals', icon: CheckCheck, to: '/app/approvals' });
    items.push({ label: 'Team', icon: Users, to: '/app/team' });
    items.push({ label: 'Locations', icon: MapPin, to: '/app/locations' });
  }

  items.push({ label: 'Announcements', icon: Megaphone, to: '/app/announcements' });

  if (isManager) {
    items.push({ label: 'Reports', icon: BarChart3, to: '/app/reports' });
  }

  // Staff reach Clock In as an ordinary row: it is the screen they open twice
  // a day and it belongs at the top of their list, not in an opt-in group.
  if (!isManager) {
    items.splice(2, 0, { label: 'Clock In', icon: LogIn, to: '/app/clock' });
  } else if (personal) {
    items.push({
      label: 'Clock In',
      icon: LogIn,
      to: '/app/clock',
      group: 'my-work',
    });
  }

  return items;
}

/**
 * The rail's second, quieter nav group: account-level destinations rather
 * than workspace ones. A manager gets Settings; staff get My Profile in the
 * same slot, `settingsTabsForRole('staff')` is empty, so a Settings link
 * would land them on a redirect every time. Help & Support is common to both.
 *
 * A manager's own account stays reachable here in either work mode — the
 * profile, password, sessions and preferences of the person signed in are not
 * a managerial function and must never be behind one.
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
