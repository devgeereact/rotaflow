import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  Clock3,
  LogIn,
  MapPin,
  Megaphone,
  Repeat2,
  Settings,
  Timer,
  TimerReset,
  Umbrella,
  UserCircle,
  Users,
} from 'lucide-react';
import type { MembershipRole } from '@/types';

/**
 * Destinations the global search can reach.
 *
 * ## What this deliberately is, and is not
 *
 * It searches **the application**. Screens, and the actions inside them, not
 * the database. Searching staff, shifts and leave requests across every table
 * needs either a server-side full-text index or a fan-out of a dozen `ilike`
 * queries on every keystroke, against tables an org may have hundreds of
 * thousands of rows in. Neither exists, and shipping the fan-out would put a
 * per-keystroke query storm on the database for a feature nobody has asked for
 * yet.
 *
 * What it does do is make every screen and most sub-screens reachable in two
 * keystrokes from anywhere, which is the thing a keyboard-driven operator
 * actually wants from `⌘K`. Record search is the obvious next step; when it
 * lands it goes in as an extra result group underneath these, and this module
 * keeps working unchanged.
 *
 * Keep `to` in step with the route table, `navigationTargets.test.ts` asserts
 * every entry here resolves to a real `<Route>`.
 */

export type SearchGroup = 'Screens' | 'Scheduling' | 'People' | 'Settings' | 'Account';

export interface SearchEntry {
  label: string;
  /** Extra words that should match this entry but do not appear in its label. */
  keywords: string;
  to: string;
  group: SearchGroup;
  icon: LucideIcon;
  /** Omitted = visible to every role. */
  roles?: readonly MembershipRole[];
}

const MANAGERIAL: readonly MembershipRole[] = ['owner', 'manager'];

export const SEARCH_ENTRIES: readonly SearchEntry[] = [
  {
    label: 'Dashboard',
    keywords: 'home overview today coverage',
    to: '/app/dashboard',
    group: 'Screens',
    icon: CalendarRange,
  },
  {
    label: 'Rota builder',
    keywords: 'build draft publish shifts grid schedule week',
    to: '/app/rota',
    group: 'Scheduling',
    icon: CalendarDays,
    roles: MANAGERIAL,
  },
  {
    label: 'Schedule',
    keywords: 'my shifts published agenda calendar week month',
    to: '/app/schedule',
    group: 'Scheduling',
    icon: CalendarRange,
  },
  {
    label: 'Clock in and out',
    keywords: 'attendance time gps punch break start finish',
    to: '/app/clock',
    group: 'Scheduling',
    icon: LogIn,
  },
  {
    label: 'Timesheets',
    keywords: 'hours worked overtime payroll approve variance',
    to: '/app/timesheets',
    group: 'Scheduling',
    icon: Timer,
  },
  {
    label: 'Availability',
    keywords: 'available unavailable preferred pattern submit',
    to: '/app/availability',
    group: 'Scheduling',
    icon: Clock3,
  },
  {
    label: 'Leave',
    keywords: 'holiday annual sick absence request approve balance entitlement',
    to: '/app/leave',
    group: 'Scheduling',
    icon: Umbrella,
  },
  {
    label: 'Shift swaps',
    keywords: 'swap cover exchange request approve',
    to: '/app/swaps',
    group: 'Scheduling',
    icon: Repeat2,
  },
  {
    label: 'Overtime',
    keywords: 'overtime extra hours additional beyond contract request approve',
    to: '/app/overtime',
    group: 'Scheduling',
    icon: TimerReset,
  },
  {
    label: 'Staff directory',
    keywords: 'people team employees members roles departments',
    to: '/app/team',
    group: 'People',
    icon: Users,
    roles: MANAGERIAL,
  },
  {
    label: 'Locations',
    keywords: 'sites departments addresses care home branches',
    to: '/app/locations',
    group: 'People',
    icon: MapPin,
    roles: MANAGERIAL,
  },
  {
    label: 'Announcements',
    keywords: 'notice message broadcast news post',
    to: '/app/announcements',
    group: 'People',
    icon: Megaphone,
  },
  {
    label: 'Notifications',
    keywords: 'alerts inbox unread reminders',
    to: '/app/notifications',
    group: 'People',
    icon: Megaphone,
  },
  {
    label: 'Reports',
    keywords: 'export csv analytics coverage labour cost absence',
    to: '/app/reports',
    group: 'People',
    icon: BarChart3,
    roles: MANAGERIAL,
  },
  {
    label: 'Organisation settings',
    keywords: 'company name industry timezone week start address',
    to: '/app/settings/organisation',
    group: 'Settings',
    icon: Settings,
    roles: MANAGERIAL,
  },
  {
    label: 'Permissions',
    keywords: 'access invite revoke team members roles matrix',
    to: '/app/settings/permissions',
    group: 'Settings',
    icon: Settings,
    roles: ['owner'],
  },
  {
    label: 'Roles',
    keywords: 'owner manager staff labels custom',
    to: '/app/settings/roles',
    group: 'Settings',
    icon: Settings,
    roles: MANAGERIAL,
  },
  {
    label: 'Policies',
    keywords: 'rules rest period notice overtime consecutive shifts compliance',
    to: '/app/settings/policies',
    group: 'Settings',
    icon: Settings,
    roles: MANAGERIAL,
  },
  {
    label: 'Notification settings',
    keywords: 'email push sms channels templates defaults',
    to: '/app/settings/notifications',
    group: 'Settings',
    icon: Settings,
    roles: MANAGERIAL,
  },
  {
    label: 'Integrations',
    keywords: 'smtp email payroll api webhooks connect',
    to: '/app/settings/integrations',
    group: 'Settings',
    icon: Settings,
    roles: MANAGERIAL,
  },
  {
    label: 'Billing',
    keywords: 'plan subscription invoices payment vat usage',
    to: '/app/settings/billing',
    group: 'Settings',
    icon: Settings,
    roles: ['owner'],
  },
  {
    label: 'Audit log',
    keywords: 'history events who changed security trail',
    to: '/app/settings/audit',
    group: 'Settings',
    icon: Settings,
    roles: MANAGERIAL,
  },
  {
    label: 'My profile',
    keywords: 'personal details name photo phone job title',
    to: '/app/account/profile',
    group: 'Account',
    icon: UserCircle,
  },
  {
    label: 'Preferences',
    keywords: 'language theme date format timezone density display',
    to: '/app/account/preferences',
    group: 'Account',
    icon: UserCircle,
  },
  {
    label: 'Security',
    keywords: 'password two factor mfa devices login alerts',
    to: '/app/account/security',
    group: 'Account',
    icon: UserCircle,
  },
  {
    label: 'Sessions',
    keywords: 'devices signed in sign out revoke',
    to: '/app/account/sessions',
    group: 'Account',
    icon: UserCircle,
  },
  {
    label: 'Activity',
    keywords: 'history changes log recent',
    to: '/app/account/activity',
    group: 'Account',
    icon: UserCircle,
  },
] as const;

/** Group order in the results list. Most-used first, account last. */
export const GROUP_ORDER: readonly SearchGroup[] = [
  'Screens',
  'Scheduling',
  'People',
  'Settings',
  'Account',
] as const;

/**
 * Entries this role may actually reach, matched against `query`.
 *
 * Role filtering happens *before* matching so a staff member never sees
 * "Billing" in a result list they would only be denied at. Matching is a plain
 * substring test over label plus keywords: with ~25 entries a fuzzy matcher
 * costs more in surprising results than it earns in convenience.
 */
export function searchEntries(query: string, role: MembershipRole | null): SearchEntry[] {
  const visible = SEARCH_ENTRIES.filter(
    (entry) => !entry.roles || (role !== null && entry.roles.includes(role)),
  );

  const term = query.trim().toLowerCase();
  if (term === '') return [...visible];

  return visible.filter((entry) =>
    `${entry.label} ${entry.keywords}`.toLowerCase().includes(term),
  );
}
