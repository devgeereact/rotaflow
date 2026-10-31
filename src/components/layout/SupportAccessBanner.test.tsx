/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Local-live walk (31 Oct 2026): the banner asked `GET support-sessions` for every member on every page, every minute, and the
// API answers that list to owners and managers only (403 for staff, by the S8a decision). The banner must ask only for the
// roles that may read it.
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
  it('never asks for the sessions as staff', async () => {
    role = 'staff';
    render(<SupportAccessBanner />);
    await new Promise((r) => setTimeout(r, 20));
    expect(listActiveSessionsForOrg).not.toHaveBeenCalled();
  });

  it.each(['owner', 'manager'] as const)('shows a live session to the %s', async (r) => {
    role = r;
    render(<SupportAccessBanner />);
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(listActiveSessionsForOrg).toHaveBeenCalledTimes(1);
  });
});
