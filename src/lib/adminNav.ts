import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpen,
  Building2,
  CreditCard,
  Flag,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  MessageCircleQuestion,
  Plug,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { PlatformRole } from '@/types';

export interface AdminNavItem {
  label: string;
  icon: LucideIcon;
  to: string;
  /** `end` so the index route does not stay active on every child. */
  end?: boolean;
  /**
   * Platform roles that may see this entry. Omit for "every administrator".
   *
   * Presentation only — the tables behind these screens carry
   * `has_platform_role(...)` policies, so hiding the link is a courtesy, not a
   * control. It exists so a support administrator is not shown a billing screen
   * full of empty tables and left to conclude the product is broken.
   */
  roles?: readonly PlatformRole[];
}

/**
 * NEW_STRUCTURE §34's platform administration routes, in its order.
 *
 * In `lib` rather than beside `AdminShell` for the same reason as
 * `sidebarNav`: `navigationTargets.test` checks every one of these against the
 * route table parsed out of `App.tsx`, and it should not have to import a React
 * tree to do it. It also keeps the component's fast refresh intact.
 */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { label: 'Overview', icon: LayoutDashboard, to: '/admin', end: true },
  { label: 'Organisations', icon: Building2, to: '/admin/organisations' },
  { label: 'Users', icon: Users, to: '/admin/users' },
  {
    label: 'Subscriptions',
    icon: CreditCard,
    to: '/admin/subscriptions',
    roles: ['platform_owner', 'platform_admin', 'platform_finance'],
  },
  {
    label: 'Billing',
    icon: Receipt,
    to: '/admin/billing',
    roles: ['platform_owner', 'platform_admin', 'platform_finance'],
  },
  { label: 'Support Centre', icon: LifeBuoy, to: '/admin/support' },
  { label: 'Support Access', icon: KeyRound, to: '/admin/support-access' },
  // Platform Health is deliberately NOT a primary entry. It and the secondary
  // "System Status" link pointed at the same route, so the console offered two
  // names for one screen and a reader had to discover they were the same thing.
  // System Status is the name people already use for it, so that is the one
  // kept — the route is unchanged, so every existing link still resolves.
  // Placeholder register, and the screen says so above the table. It is in the
  // nav anyway because the decision it exists to force — who declares, who
  // owns, and whether anyone outside this console may read it — is one nobody
  // makes while the screen is invisible.
  { label: 'Incidents', icon: AlertTriangle, to: '/admin/incidents' },
  { label: 'Integrations', icon: Plug, to: '/admin/integrations' },
  {
    label: 'Notifications',
    icon: Bell,
    to: '/admin/notifications',
    roles: ['platform_owner', 'platform_admin'],
  },
  { label: 'Audit Logs', icon: ScrollText, to: '/admin/audit' },
  {
    label: 'Feature Flags',
    icon: Flag,
    to: '/admin/feature-flags',
    roles: ['platform_owner', 'platform_admin'],
  },
  // Deliberately unrestricted, unlike the console reference, which lists GDPR
  // as owner/admin only. `/admin/gdpr` carries no `RequirePlatformRole` in the
  // route table, and hiding a link whose route still renders when typed is a
  // decoration rather than a permission. The narrowing lands with the screen
  // itself, where the nav gate, the route gate and the table's
  // `has_platform_role(...)` policy can be changed together.
  { label: 'GDPR & Data', icon: ShieldCheck, to: '/admin/gdpr' },
  {
    label: 'Platform Settings',
    icon: Settings,
    to: '/admin/settings',
    roles: ['platform_owner', 'platform_admin'],
  },
] as const;

/**
 * The console's secondary navigation — the things that are not a platform
 * screen: reference material, and the way back out.
 *
 * Separate from `ADMIN_NAV` because `navigationTargets.test` asserts every
 * `ADMIN_NAV.to` resolves to a real `<Route>` in `App.tsx`, and these do not
 * all point at one: `/contact` is a marketing route and "Return to
 * organisation" leaves the console entirely. Mixing them would either weaken
 * that assertion or force two of these to become admin routes that have no
 * reason to exist.
 */
export const ADMIN_SECONDARY_NAV: readonly AdminNavItem[] = [
  { label: 'Documentation', icon: BookOpen, to: '/resources' },
  // The only way into the health screen. See the note in `ADMIN_NAV`.
  { label: 'System Status', icon: Activity, to: '/admin/platform-health' },
  { label: 'Platform Support', icon: MessageCircleQuestion, to: '/contact' },
] as const;

/**
 * Filters the console nav for a role.
 *
 * A `null` role — which covers both "holds no granular grant" and "the grant
 * could not be read", since `OrgContext` swallows that failure so a missing RPC
 * cannot blank the tenant session — shows the unrestricted entries only. That
 * degrades to less navigation, never to more.
 */
export function adminNavForRole(role: PlatformRole | null): AdminNavItem[] {
  return ADMIN_NAV.filter((item) => !item.roles || (role && item.roles.includes(role)));
}
