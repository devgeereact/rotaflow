import type { TabItem } from '@/components/ui/Tabs';
import type { MembershipRole } from '@/types';

/**
 * The Settings and My Profile tab sets, in the order the designs show them
 * (design/SettingsOrganisation.png, design/ProfileSettings.png).
 *
 * Single source of truth on purpose: eleven screens are still to be built
 * against these, and a tab bar that differs by one item between two pages is
 * the kind of thing nobody notices until a customer does.
 *
 * Routes are the intended shape, not all built yet — `docs/SCREENS.md` §3/§4
 * tracks which exist. A tab whose route has no page yet still belongs here, so
 * the bar is complete and the gap is visible rather than silently missing.
 */

export const SETTINGS_TABS: readonly TabItem[] = [
  { to: '/app/settings/organisation', label: 'Organisation' },
  { to: '/app/settings/permissions', label: 'Permissions' },
  { to: '/app/settings/roles', label: 'Roles' },
  { to: '/app/settings/policies', label: 'Policies' },
  { to: '/app/settings/notifications', label: 'Notifications' },
  { to: '/app/settings/integrations', label: 'Integrations' },
  { to: '/app/settings/billing', label: 'Billing' },
  { to: '/app/settings/audit', label: 'Audit' },
] as const;

export const PROFILE_TABS: readonly TabItem[] = [
  { to: '/app/account/profile', label: 'Profile' },
  { to: '/app/account/preferences', label: 'Preferences' },
  { to: '/app/account/security', label: 'Security' },
  { to: '/app/account/sessions', label: 'Sessions' },
  { to: '/app/account/tokens', label: 'API Tokens' },
  { to: '/app/account/activity', label: 'Activity' },
] as const;

/**
 * Settings tabs visible to a role.
 *
 * The whole Settings area is organisation administration — billing, policies,
 * permissions, the audit trail. `memberships.role` is a fixed
 * `owner | manager | staff` CHECK, and staff have no business in any of it, so
 * they get nothing rather than a bar full of links that all 403.
 *
 * Owner-only rather than manager-visible: Billing spends money and Permissions
 * can grant someone else the ability to. Everything else is shared with
 * managers. This mirrors the RLS already in `0002_rotaflow.sql`, which is the
 * real boundary — hiding a tab is presentation, not enforcement, and the server
 * must keep refusing regardless of what the bar shows.
 */
export function settingsTabsForRole(role: MembershipRole | null): TabItem[] {
  if (role !== 'owner' && role !== 'manager') return [];

  // Audit is owner-only because `audit_logs_select` in 0002_rotaflow.sql is
  // owner-only. The tab bar follows RLS, never the other way round — the first
  // draft of 0013 widened the policy to match this list instead, which had it
  // backwards. Widening access to a trail of who changed whose role is a
  // security decision, and 0002 already made it.
  const ownerOnly = new Set([
    '/app/settings/billing',
    '/app/settings/permissions',
    '/app/settings/audit',
  ]);
  return SETTINGS_TABS.filter((tab) => role === 'owner' || !ownerOnly.has(tab.to)).map(
    (tab) => ({ ...tab }),
  );
}

/** My Profile is a person's own account, so every role sees every tab. */
export function profileTabs(): TabItem[] {
  return PROFILE_TABS.map((tab) => ({ ...tab }));
}
