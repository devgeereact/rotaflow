import { describe, expect, it } from 'vitest';
import {
  PROFILE_TABS,
  SETTINGS_TABS,
  profileTabs,
  settingsTabsForRole,
} from '@/lib/settingsTabs';

/**
 * Tab visibility is presentation, not enforcement. RLS in
 * `0002_rotaflow.sql` is the real boundary. These tests exist anyway, because
 * the failure they prevent is a staff member being shown a Billing link that
 * 403s, which reads as a broken product rather than a locked door.
 */

describe('settingsTabsForRole', () => {
  it('shows an owner every tab', () => {
    expect(settingsTabsForRole('owner')).toHaveLength(SETTINGS_TABS.length);
  });

  it('hides Billing and Permissions from a manager', () => {
    // Billing spends money; Permissions can grant someone the ability to.
    const routes = settingsTabsForRole('manager').map((t) => t.to);
    expect(routes).not.toContain('/app/settings/billing');
    expect(routes).not.toContain('/app/settings/permissions');
    expect(routes).toContain('/app/settings/organisation');
    expect(routes).toContain('/app/settings/audit');
  });

  it('shows staff nothing at all', () => {
    // Not "an empty-looking bar", no bar. Settings is org administration and
    // staff have no reachable tab in it.
    expect(settingsTabsForRole('staff')).toEqual([]);
  });

  it('shows nothing when the role is not resolved yet', () => {
    // `null` is the pre-membership state during boot. Rendering the full bar
    // and then removing tabs a beat later is worse than rendering none.
    expect(settingsTabsForRole(null)).toEqual([]);
  });

  it('keeps the designed order', () => {
    // docs/design/SettingsOrganisation.png reads left to right in this order;
    // re-ordering silently disagrees with every mockup.
    expect(settingsTabsForRole('owner').map((t) => t.label)).toEqual([
      'Organisation',
      'Permissions',
      'Roles',
      'Policies',
      'Notifications',
      'Integrations',
      'Billing',
      'Audit',
    ]);
  });

  it('never returns the shared constant, so a caller cannot mutate the source', () => {
    const first = settingsTabsForRole('owner');
    first[0]!.label = 'MUTATED';
    expect(settingsTabsForRole('owner')[0]!.label).toBe('Organisation');
  });

  it('routes are unique and absolute', () => {
    const routes = SETTINGS_TABS.map((t) => t.to);
    expect(new Set(routes).size).toBe(routes.length);
    for (const route of routes) expect(route.startsWith('/app/settings/')).toBe(true);
  });
});

describe('profileTabs', () => {
  it('shows every tab. It is the person’s own account', () => {
    expect(profileTabs()).toHaveLength(PROFILE_TABS.length);
  });

  it('keeps the designed order', () => {
    // NEW_STRUCTURE §21 lists Connected Accounts between Security and
    // Sessions; the rest is the order the reference screens show.
    expect(profileTabs().map((t) => t.label)).toEqual([
      'Profile',
      'Preferences',
      'Security',
      'Connected Accounts',
      'Sessions',
      'API Tokens',
      'Activity',
    ]);
  });

  it('routes are unique and absolute', () => {
    const routes = PROFILE_TABS.map((t) => t.to);
    expect(new Set(routes).size).toBe(routes.length);
    for (const route of routes) expect(route.startsWith('/app/account/')).toBe(true);
  });

  it('does not collide with the settings routes', () => {
    const all = [...SETTINGS_TABS, ...PROFILE_TABS].map((t) => t.to);
    expect(new Set(all).size).toBe(all.length);
  });
});
