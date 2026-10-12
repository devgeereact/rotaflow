import type { TabItem } from '@/components/ui/Tabs';
import type { MembershipRole } from '@/types';

/**
 * The Settings and My account tab sets, in the order the designs show them
 * (docs/design/SettingsOrganisation.png, docs/design/ProfileSettings.png).
 *
 * Single source of truth on purpose: eleven screens are still to be built
 * against these, and a tab bar that differs by one item between two pages is
 * the kind of thing nobody notices until a customer does.
 *
 * Routes are the intended shape, not all built yet, `docs/UX-SPEC.md` §3/§4
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
  // §21's "Connected Accounts", between Security and Sessions as listed there.
  { to: '/app/account/accounts', label: 'Connected Accounts' },
  { to: '/app/account/sessions', label: 'Sessions' },
  // Hidden until a public API exists: a tab for a feature that does not exist
  // reads as unfinished. The route and page stay, so a saved link still works.
  { to: '/app/account/tokens', label: 'API Tokens', hidden: true },
  { to: '/app/account/activity', label: 'Activity' },
] as const;

/**
 * Settings sections only an owner can use.
 *
 * Billing spends money and Permissions can grant someone else the ability to.
 * Organisation and Audit are owner-only on the page itself
 * (`SettingsOrganisationPage`, `SettingsAuditPage` both render
 * `OwnerOnlyNotice` to anyone else), so showing a manager either tab only to
 * refuse them on arrival reads as a broken product rather than a locked door.
 */
const OWNER_ONLY_SETTINGS: ReadonlySet<string> = new Set([
  '/app/settings/organisation',
  '/app/settings/permissions',
  '/app/settings/billing',
  '/app/settings/audit',
]);

/**
 * Settings tabs visible to a role.
 *
 * The whole Settings area is organisation administration. Billing, policies,
 * permissions, the audit trail. `memberships.role` is a fixed
 * `owner | manager | staff` CHECK, and staff have no business in any of it, so
 * they get nothing rather than a bar full of links that all 403.
 *
 * Owners see every tab. Managers see the sections they can actually use:
 * Roles, Policies, Notifications and Integrations. This mirrors the RLS
 * already in `0002_rotaflow.sql`, which is the real boundary. Hiding a tab is
 * presentation, not enforcement, and the server must keep refusing regardless
 * of what the bar shows.
 */
export function settingsTabsForRole(role: MembershipRole | null): TabItem[] {
  if (role !== 'owner' && role !== 'manager') return [];

  return SETTINGS_TABS.filter(
    (tab) => role === 'owner' || !OWNER_ONLY_SETTINGS.has(tab.to),
  ).map((tab) => ({ ...tab }));
}

/**
 * Where `/app/settings` itself lands: the first section this role can use.
 *
 * It used to be a fixed redirect to Organisation, which is owner-only, so a
 * manager who opened Settings landed on a refusal. Owners still land on
 * Organisation. `null` when the role has no Settings sections at all (staff,
 * or a role not resolved yet), and the layout handles that case.
 */
export function defaultSettingsPath(role: MembershipRole | null): string | null {
  return settingsTabsForRole(role)[0]?.to ?? null;
}

/** My account is a person's own account, so every role sees every tab. */
export function profileTabs(): TabItem[] {
  return PROFILE_TABS.filter((tab) => !tab.hidden).map((tab) => ({ ...tab }));
}
