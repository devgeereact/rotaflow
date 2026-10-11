import { describe, expect, it } from 'vitest';
import {
  PROFILE_TABS,
  SETTINGS_TABS,
  defaultSettingsPath,
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

  it('hides every owner-only section from a manager', () => {
    // Billing spends money; Permissions can grant someone the ability to.
    // Organisation and Audit render OwnerOnlyNotice to a manager, so showing
    // the tab only led to a refusal.
    const routes = settingsTabsForRole('manager').map((t) => t.to);
    expect(routes).not.toContain('/app/settings/billing');
    expect(routes).not.toContain('/app/settings/permissions');
    expect(routes).not.toContain('/app/settings/organisation');
    expect(routes).not.toContain('/app/settings/audit');
    expect(routes).toEqual([
      '/app/settings/roles',
      '/app/settings/policies',
      '/app/settings/notifications',
      '/app/settings/integrations',
    ]);
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

describe('defaultSettingsPath', () => {
  it('lands an owner on Organisation', () => {
    expect(defaultSettingsPath('owner')).toBe('/app/settings/organisation');
  });

  it('lands a manager on the first section they can use, not a refusal', () => {
    expect(defaultSettingsPath('manager')).toBe('/app/settings/roles');
  });

  it('has nowhere to land for staff or an unresolved role', () => {
    expect(defaultSettingsPath('staff')).toBeNull();
    expect(defaultSettingsPath(null)).toBeNull();
  });
});

describe('profileTabs', () => {
  it('shows every tab that is not hidden. It is the person’s own account', () => {
    expect(profileTabs()).toHaveLength(PROFILE_TABS.filter((t) => !t.hidden).length);
  });

  it('hides API tokens from the bar but keeps its route in the list', () => {
    // No public API exists yet. The page and route stay so a saved link works.
    expect(PROFILE_TABS.map((t) => t.to)).toContain('/app/account/tokens');
    expect(profileTabs().map((t) => t.to)).not.toContain('/app/account/tokens');
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
