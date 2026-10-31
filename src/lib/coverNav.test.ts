import { describe, expect, it } from 'vitest';
import { navItemsForRole } from '@/lib/sidebarNav';

// The cover module (S12) ships dark: with the `cover_tools` flag off nothing about it appears.

describe('cover behind its flag', () => {
  it('adds no row while the flag is off', () => {
    for (const role of ['owner', 'manager', 'staff'] as const) {
      expect(navItemsForRole(role).some((i) => i.to === '/app/cover')).toBe(false);
    }
  });

  it('gives everyone the Cover row when it is on', () => {
    for (const role of ['owner', 'manager', 'staff'] as const) {
      expect(
        navItemsForRole(role, { cover: true }).find((i) => i.to === '/app/cover')?.label,
      ).toBe('Cover');
    }
  });
});
