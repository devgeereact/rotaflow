import {
  Building2,
  CreditCard,
  Flag,
  LayoutDashboard,
  LifeBuoy,
  ScrollText,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface AdminNavItem {
  label: string;
  icon: LucideIcon;
  to: string;
  /** `end` so the index route does not stay active on every child. */
  end?: boolean;
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
  { label: 'Billing', icon: CreditCard, to: '/admin/billing' },
  { label: 'Support', icon: LifeBuoy, to: '/admin/support' },
  { label: 'Audit', icon: ScrollText, to: '/admin/audit' },
  { label: 'Feature flags', icon: Flag, to: '/admin/feature-flags' },
] as const;
