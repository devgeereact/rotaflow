/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Local-live walk (31 Oct 2026): a manager opening Settings > Integrations got "Could not load SMTP settings" and a reported
// error, because the page asked the owner-only `GET smtp` (403) before checking the role. On Supabase the same read returned
// no row under RLS, so the manager saw only the owner-only notice. The page must not ask unless the person is the owner.
let canManageOrg = false;
const getOrgSmtpSettings = vi.fn(() => Promise.resolve(null));
const showError = vi.fn<(m: string) => void>();
const reportError = vi.fn<(...a: unknown[]) => void>();

vi.mock('@/hooks/useOrg', () => ({
  useOrg: () => ({ orgId: 'org-1', role: 'manager' }),
}));
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ canManageOrg }) }));
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ showError, showSuccess: vi.fn() }),
}));
vi.mock('@/hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));
vi.mock('@/hooks/useOrgBillingState', () => ({
  useOrgBillingState: () => ({ state: null }),
}));
vi.mock('@/lib/sentry', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));
vi.mock('@/services/orgService', () => ({
  getOrganisation: () => Promise.resolve({ timezone: 'Europe/London' }),
}));
vi.mock('@/services/smtpSettingsService', () => ({
  getOrgSmtpSettings: () => getOrgSmtpSettings(),
  saveOrgSmtpSettings: vi.fn(),
  testOrgSmtpSettings: vi.fn(),
  updateOrgSmtpFields: vi.fn(),
  deleteOrgSmtpSettings: vi.fn(),
}));

const { SettingsIntegrationsPage } = await import('./SettingsIntegrationsPage');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SettingsIntegrationsPage', () => {
  it('a manager sees the owner-only notice and the owner-only settings are never requested', async () => {
    canManageOrg = false;
    render(
      <MemoryRouter>
        <SettingsIntegrationsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Only the organisation owner/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(getOrgSmtpSettings).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('the owner loads them', async () => {
    canManageOrg = true;
    render(
      <MemoryRouter>
        <SettingsIntegrationsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(getOrgSmtpSettings).toHaveBeenCalledTimes(1));
  });
});
