import {
  BookOpen,
  Building2,
  CreditCard,
  Flag,
  LayoutDashboard,
  LifeBuoy,
  MessageCircleQuestion,
  Receipt,
  ScrollText,
  Settings,
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
  { label: 'Platform users', icon: Users, to: '/admin/users' },
  {
    label: 'Subscriptions',
    icon: Receipt,
    to: '/admin/subscriptions',
    roles: ['platform_owner', 'platform_admin', 'platform_finance'],
  },
  {
    label: 'Billing',
    icon: CreditCard,
    to: '/admin/billing',
    roles: ['platform_owner', 'platform_admin', 'platform_finance'],
  },
  { label: 'Support', icon: LifeBuoy, to: '/admin/support' },
  { label: 'Audit', icon: ScrollText, to: '/admin/audit' },
  {
    label: 'Feature flags',
    icon: Flag,
    to: '/admin/feature-flags',
    roles: ['platform_owner', 'platform_admin'],
  },
  {
    label: 'Platform settings',
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
  { label: 'Platform support', icon: MessageCircleQuestion, to: '/contact' },
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
