/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Owner decision (31 Oct 2026), reversing the local-live walk's interim fix: every member sees that RotaFlow support is inside
// their organisation, as on Supabase. The API answers staff with the live sessions only (suite 150); only an owner may end one.
let role: 'owner' | 'manager' | 'staff' = 'staff';
const listActiveSessionsForOrg = vi.fn(() =>
  Promise.resolve([
    {
      id: 's1',
      orgId: 'org-1',
      adminName: 'Sue Support',
      reason: 'Looking into a missed clock-in',
      caseRef: 'CASE-4120',
      scope: 'read' as const,
      grantedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      revokedAt: null,
      revokeReason: null,
    },
  ]),
);

vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1', role }) }));
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));
vi.mock('@/services/supportAccessService', () => ({
  listActiveSessionsForOrg: () => listActiveSessionsForOrg(),
  revokeSupportAccessForOrg: vi.fn(),
}));

const { SupportAccessBanner } = await import('./SupportAccessBanner');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SupportAccessBanner', () => {
  it.each(['owner', 'manager', 'staff'] as const)(
    'shows a live session to the %s',
    async (r) => {
      role = r;
      render(<SupportAccessBanner />);
      expect(await screen.findByRole('status')).toBeTruthy();
      expect(screen.getByText(/Sue Support/)).toBeTruthy();
      expect(listActiveSessionsForOrg).toHaveBeenCalledTimes(1);
    },
  );

  it('offers to end the session to the owner only', async () => {
    role = 'staff';
    render(<SupportAccessBanner />);
    await screen.findByRole('status');
    expect(screen.queryByRole('button', { name: 'End this session' })).toBeNull();
    cleanup();
    role = 'owner';
    render(<SupportAccessBanner />);
    expect(await screen.findByRole('button', { name: 'End this session' })).toBeTruthy();
  });
});
