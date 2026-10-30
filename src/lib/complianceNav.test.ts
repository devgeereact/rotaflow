import { describe, expect, it } from 'vitest';
import { navItemsForRole } from '@/lib/sidebarNav';
import { settingsTabsForRole } from '@/lib/settingsTabs';

// The compliance module ships dark: with the `staff_documents` flag off nothing about it appears.

describe('compliance behind its flag', () => {
  it('adds no row while the flag is off', () => {
    for (const role of ['owner', 'manager', 'staff'] as const) {
      expect(navItemsForRole(role).some((i) => i.to === '/app/compliance')).toBe(false);
    }
  });

  it('gives managers Compliance and staff My documents when it is on', () => {
    expect(
      navItemsForRole('manager', { compliance: true }).find(
        (i) => i.to === '/app/compliance',
      )?.label,
    ).toBe('Compliance');
    expect(
      navItemsForRole('staff', { compliance: true }).find(
        (i) => i.to === '/app/compliance',
      )?.label,
    ).toBe('My documents');
  });

  it('shows the Document types settings tab to owners and managers only, and only when on', () => {
    const has = (tabs: { to: string }[]): boolean =>
      tabs.some((t) => t.to === '/app/settings/document-types');
    expect(has(settingsTabsForRole('owner'))).toBe(false);
    expect(has(settingsTabsForRole('owner', { documentTypes: true }))).toBe(true);
    expect(has(settingsTabsForRole('manager', { documentTypes: true }))).toBe(true);
    expect(settingsTabsForRole('staff', { documentTypes: true })).toEqual([]);
  });
});
