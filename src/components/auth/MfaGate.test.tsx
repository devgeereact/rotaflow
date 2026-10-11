/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sign-in second factor (CAP-049), through the component that holds the
 * app back. The service is mocked: what is under test is that protected
 * content does not render while a factor is owed, that a wrong code keeps the
 * person on the step with an explanation, and that sign-out is always there.
 */

const mfa = vi.hoisted(() => ({
  getMfaAssurance: vi.fn(),
  listMfaFactors: vi.fn(),
  verifySignInCode: vi.fn(),
}));
const signOut = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({
  session: { access_token: 'token-aal1', user: { id: 'user-1' } },
}));

vi.mock('@/services/mfaService', () => mfa);
vi.mock('@/lib/sentry', () => ({ reportError: vi.fn() }));
vi.mock('@/hooks/useSupabaseAuth', () => ({
  useSupabaseAuth: () => ({
    session: auth.session,
    user: auth.session?.user ?? null,
    loading: false,
    signOut,
  }),
}));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ refresh }) }));
vi.mock('@/components/AppBootScreen', () => ({
  AppBootScreen: () => <p>Booting</p>,
}));

const TOTP = {
  id: 'f1',
  friendlyName: 'Work phone',
  createdAt: '2026-09-01T10:00:00Z',
  status: 'verified' as const,
  factorType: 'totp',
};

/** Renders the gate; the returned function re-renders after `auth.session` changes. */
async function renderGate(): Promise<() => void> {
  const { MfaGate } = await import('@/components/auth/MfaGate');
  const tree = (): JSX.Element => (
    <MemoryRouter>
      <MfaGate>
        <p>Protected content</p>
      </MfaGate>
    </MemoryRouter>
  );
  const { rerender } = render(tree());
  return () => rerender(tree());
}

describe('MfaGate', () => {
  beforeEach(() => {
    auth.session = { access_token: 'token-aal1', user: { id: 'user-1' } };
    mfa.getMfaAssurance.mockReset();
    mfa.listMfaFactors.mockReset();
    mfa.verifySignInCode.mockReset();
    signOut.mockReset().mockResolvedValue(undefined);
    refresh.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the app straight away for an account with no factor', async () => {
    mfa.getMfaAssurance.mockResolvedValue({ currentLevel: 'aal1', nextLevel: 'aal1' });
    await renderGate();
    expect(await screen.findByText('Protected content')).toBeTruthy();
    expect(mfa.listMfaFactors).not.toHaveBeenCalled();
  });

  it('asks for the code, and shows nothing protected, when a factor is owed', async () => {
    mfa.getMfaAssurance.mockResolvedValue({ currentLevel: 'aal1', nextLevel: 'aal2' });
    mfa.listMfaFactors.mockResolvedValue([TOTP]);
    await renderGate();

    const input = await screen.findByLabelText('6-digit code');
    expect(screen.queryByText('Protected content')).toBeNull();
    expect(
      screen.getByText('Enter the 6-digit code from your authenticator app.'),
    ).toBeTruthy();
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(document.activeElement).toBe(input);
  });

  it('keeps the person on the step after a wrong code, cleared and refocused', async () => {
    mfa.getMfaAssurance.mockResolvedValue({ currentLevel: 'aal1', nextLevel: 'aal2' });
    mfa.listMfaFactors.mockResolvedValue([TOTP]);
    mfa.verifySignInCode.mockRejectedValue({
      code: 'mfa_verification_failed',
      status: 422,
      message: 'Invalid TOTP code entered',
    });
    await renderGate();
    const user = userEvent.setup();

    const input = await screen.findByLabelText<HTMLInputElement>('6-digit code');
    await user.type(input, '123 456');
    expect(input.value).toBe('123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(mfa.verifySignInCode).toHaveBeenCalledWith('f1', '123456');
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/not accepted/),
    );
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText('Protected content')).toBeNull();
  });

  it('opens the app once the code is accepted and the session is aal2', async () => {
    mfa.getMfaAssurance
      .mockResolvedValueOnce({ currentLevel: 'aal1', nextLevel: 'aal2' })
      .mockResolvedValue({ currentLevel: 'aal2', nextLevel: 'aal2' });
    mfa.listMfaFactors.mockResolvedValue([TOTP]);
    mfa.verifySignInCode.mockResolvedValue(undefined);
    await renderGate();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('6-digit code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('Protected content')).toBeTruthy();
    // The console gate's flag is re-read at aal2.
    expect(refresh).toHaveBeenCalled();
  });

  it('lets somebody with two authenticators choose which one', async () => {
    mfa.getMfaAssurance.mockResolvedValue({ currentLevel: 'aal1', nextLevel: 'aal2' });
    mfa.listMfaFactors.mockResolvedValue([
      TOTP,
      { ...TOTP, id: 'f2', friendlyName: 'Tablet', createdAt: '2026-10-01T10:00:00Z' },
    ]);
    mfa.verifySignInCode.mockRejectedValue({ status: 0, message: 'Failed to fetch' });
    await renderGate();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('radio', { name: /Tablet/ }));
    await user.type(screen.getByLabelText('6-digit code'), '111111');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(mfa.verifySignInCode).toHaveBeenCalledWith('f2', '111111');
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/Could not reach the server/),
    );
  });

  it('always offers sign out', async () => {
    mfa.getMfaAssurance.mockResolvedValue({ currentLevel: 'aal1', nextLevel: 'aal2' });
    mfa.listMfaFactors.mockResolvedValue([TOTP]);
    await renderGate();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('accepts a pasted code with a space in it', async () => {
    mfa.getMfaAssurance.mockResolvedValue({ currentLevel: 'aal1', nextLevel: 'aal2' });
    mfa.listMfaFactors.mockResolvedValue([TOTP]);
    await renderGate();
    const user = userEvent.setup();

    const input = await screen.findByLabelText<HTMLInputElement>('6-digit code');
    await user.click(input);
    await user.paste('123 456');
    expect(input.value).toBe('123456');
  });

  it('explains an expired challenge and keeps the person on the step', async () => {
    mfa.getMfaAssurance.mockResolvedValue({ currentLevel: 'aal1', nextLevel: 'aal2' });
    mfa.listMfaFactors.mockResolvedValue([TOTP]);
    mfa.verifySignInCode.mockRejectedValue({
      code: 'mfa_challenge_expired',
      status: 422,
    });
    await renderGate();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('6-digit code'), '222222');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/expired/));
    expect(screen.getByLabelText<HTMLInputElement>('6-digit code').value).toBe('');
    expect(screen.queryByText('Protected content')).toBeNull();
  });

  it('keeps the app mounted across a token refresh for an admitted session', async () => {
    mfa.getMfaAssurance.mockResolvedValue({ currentLevel: 'aal2', nextLevel: 'aal2' });
    const rerender = await renderGate();
    const content = await screen.findByText('Protected content');

    auth.session = { access_token: 'token-refreshed', user: { id: 'user-1' } };
    rerender();

    // Same node: nothing unmounted while the new token was checked.
    expect(screen.getByText('Protected content')).toBe(content);
    await waitFor(() => expect(mfa.getMfaAssurance).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Protected content')).toBe(content);
  });

  it('asks again when the same person is handed a session that owes a factor', async () => {
    // Another tab signed in afresh with a password: same user, new aal1 token.
    mfa.getMfaAssurance
      .mockResolvedValueOnce({ currentLevel: 'aal2', nextLevel: 'aal2' })
      .mockResolvedValue({ currentLevel: 'aal1', nextLevel: 'aal2' });
    mfa.listMfaFactors.mockResolvedValue([TOTP]);
    const rerender = await renderGate();
    await screen.findByText('Protected content');

    auth.session = { access_token: 'token-new-aal1', user: { id: 'user-1' } };
    rerender();

    expect(await screen.findByLabelText('6-digit code')).toBeTruthy();
    expect(screen.queryByText('Protected content')).toBeNull();
  });

  it('shows nothing protected while the first check is still running', async () => {
    mfa.getMfaAssurance.mockReturnValue(new Promise(() => undefined));
    await renderGate();

    expect(screen.getByText('Booting')).toBeTruthy();
    expect(screen.queryByText('Protected content')).toBeNull();
  });

  it('fails closed when the level cannot be read', async () => {
    mfa.getMfaAssurance.mockRejectedValue(new Error('storage unavailable'));
    await renderGate();

    expect(await screen.findByText('Could not check your sign-in')).toBeTruthy();
    expect(screen.queryByText('Protected content')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});
