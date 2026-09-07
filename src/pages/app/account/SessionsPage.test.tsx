/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signOut = vi.hoisted(() => vi.fn());
const clearTenantState = vi.hoisted(() => vi.fn());
const listMySessions = vi.hoisted(() => vi.fn());
const confirm = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      signOut,
    },
  },
}));
vi.mock('@/lib/session', () => ({ clearTenantState }));
vi.mock('@/lib/sentry', () => ({ reportError: vi.fn() }));
vi.mock('@/services/profileService', () => ({
  listMySessions,
  revokeMyOtherSessions: vi.fn(),
}));
vi.mock('@/hooks/useConfirm', () => ({ useConfirm: () => ({ confirm }) }));
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));

import { SessionsPage } from '@/pages/app/account/SessionsPage';

describe('SessionsPage', () => {
  beforeEach(() => {
    signOut.mockReset().mockResolvedValue({ error: null });
    clearTenantState.mockReset().mockResolvedValue(undefined);
    listMySessions.mockReset().mockResolvedValue([]);
    confirm.mockReset().mockResolvedValue(true);
  });

  afterEach(() => cleanup());

  it('purges tenant caches after signing out every device', async () => {
    render(<SessionsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));

    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ scope: 'global' }));
    expect(clearTenantState).toHaveBeenCalledOnce();
  });

  it('still purges tenant caches when remote sign-out fails', async () => {
    signOut.mockResolvedValue({ error: new Error('offline') });
    render(<SessionsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));

    await waitFor(() => expect(clearTenantState).toHaveBeenCalledOnce());
  });
});
