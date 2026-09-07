import { useCallback, useState, type ChangeEvent } from 'react';
import { CheckCircle2, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { evaluatePassword } from '@/lib/password';
import { PasswordRequirements } from '@/components/auth/PasswordRequirements';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { TwoFactorSection } from '@/components/account/TwoFactorSection';

/**
 * `/app/account/security`. Design/ProfileSecurity.png.
 *
 * ## The "Security check-up" scoring is deliberately not built
 *
 * The reference shows a 100% ring over four green ticks: password is strong,
 * two-factor authentication, recovery email set, no security issues found.
 * Three of those four cannot be answered honestly from this client:
 *
 * - **Password strength**. Supabase stores a hash. The browser cannot inspect
 *   it, so the only truthful statement is about a password being typed *now*.
 * - **Two-factor**. Answerable since `0102` — `TwoFactorSection` reads the
 *   real factor list. The other two are still not.
 * - **"No security issues found"**. Nothing scans for any.
 *
 * A 100% Secure ring that is really a static graphic is the worst possible
 * version of this card: it tells someone they are protected when nothing has
 * been checked. So the screen shows the checks it can actually perform, and
 * names 2FA as unavailable rather than absent.
 */
export function SecurityPage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const { showError, showSuccess } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const email = user?.email ?? null;

  /**
   * Whether this account has a password at all.
   *
   * Someone who signed up with Google or GitHub has no password identity, so
   * asking them for their current one would be asking for something that does
   * not exist. `identities` carries one entry per provider.
   */
  const hasPasswordIdentity =
    user?.identities?.some((identity) => identity.provider === 'email') ?? true;

  const requirements = evaluatePassword(newPassword);
  const passwordValid = requirements.every((r) => r.met);
  const passwordsMatch = newPassword === confirmPassword;

  const handleChangePassword = useCallback(async (): Promise<void> => {
    if (!passwordValid || !passwordsMatch || !currentPassword || !email) return;
    setSaving(true);
    try {
      // Prove the person at the keyboard knows the current password, before
      // anything is changed.
      //
      // Supabase will happily change a password for anyone holding a live
      // session, and that is the wrong default for the case this screen
      // exists to serve. Someone who picks up an unlocked laptop, or who has
      // stolen a session token, does not usually know the password. Without
      // this check they could set a new one and lock the real owner out, and
      // the "end every other session" step below would then kick the owner
      // out on their behalf. The re-authentication is what makes that step
      // safe rather than a weapon.
      //
      // `signInWithPassword` against the same account is the check. It issues
      // a fresh session for this device, which is harmless, and it fails
      // without side effects when the password is wrong.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (reauthError) {
        setCurrentPassword('');
        showError('That is not your current password.');
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      // End every other session, explicitly.
      //
      // Whether a password change revokes other refresh tokens is a GoTrue
      // server setting, so the panel's promise was true or false depending on
      // configuration nobody here controls. `scope: 'others'` revokes them and
      // leaves this device signed in. A failure is reported rather than
      // swallowed: "your password changed but the attacker may still be signed
      // in" is not something to keep quiet about.
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' });
      if (signOutError) {
        reportError(signOutError, { area: 'account-security:revoke-others' });
        showError(
          'Password changed, but other sessions could not be ended. Use Sign out everywhere on Sessions.',
        );
      } else {
        showSuccess('Password changed and every other session ended.');
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      reportError(err, { area: 'account-security:change-password' });
      showError('Could not change your password. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [
    passwordValid,
    passwordsMatch,
    currentPassword,
    email,
    newPassword,
    showError,
    showSuccess,
  ]);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <SettingsSection
          title="Change password"
          description="You stay signed in on this device. Every other session is ended."
        >
          {!hasPasswordIdentity ? (
            <p className="max-w-md text-sm text-content-muted dark:text-content-muted-dark">
              This account signs in with{' '}
              {user?.identities?.map((i) => i.provider).join(' and ') ?? 'a provider'}{' '}
              rather than a password, so there is nothing to change here. Manage it with
              that provider, where two-factor and recovery live too.
            </p>
          ) : (
            <div className="max-w-md space-y-4">
              <div>
                <Label htmlFor="security-current-password">Current password</Label>
                <Input
                  id="security-current-password"
                  type="password"
                  autoComplete="current-password"
                  icon={Lock}
                  value={currentPassword}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setCurrentPassword(e.target.value)
                  }
                />
                <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
                  Asked for because holding a signed-in session is not proof of who you
                  are. Somebody at an unlocked laptop should not be able to lock you out
                  of your own account.
                </p>
              </div>

              <div>
                <Label htmlFor="security-new-password">New password</Label>
                <Input
                  id="security-new-password"
                  type="password"
                  autoComplete="new-password"
                  icon={Lock}
                  value={newPassword}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setNewPassword(e.target.value)
                  }
                />
              </div>

              {newPassword && <PasswordRequirements requirements={requirements} />}

              <div>
                <Label htmlFor="security-confirm-password">Confirm new password</Label>
                <Input
                  id="security-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  icon={Lock}
                  value={confirmPassword}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setConfirmPassword(e.target.value)
                  }
                />
              </div>

              {confirmPassword && !passwordsMatch && (
                <p
                  className="text-sm text-danger-ink dark:text-danger-ink-dark"
                  role="alert"
                >
                  Those passwords do not match.
                </p>
              )}

              <Button
                onClick={() => void handleChangePassword()}
                disabled={saving || !passwordValid || !passwordsMatch || !currentPassword}
              >
                {saving ? 'Changing…' : 'Change password'}
              </Button>
            </div>
          )}
        </SettingsSection>
      </div>

      <div className="space-y-6">
        <SettingsSection title="Sign-in">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-content-muted dark:text-content-muted-dark">
                Email address
              </dt>
              <dd className="mt-0.5 break-all text-content dark:text-content-dark">
                {user?.email ?? '-'}
              </dd>
            </div>
            <div>
              <dt className="text-content-muted dark:text-content-muted-dark">
                Email confirmed
              </dt>
              <dd className="mt-0.5 flex items-center gap-1.5 text-content dark:text-content-dark">
                {user?.email_confirmed_at ? (
                  <>
                    <CheckCircle2 size={15} className="text-success" aria-hidden="true" />
                    Yes
                  </>
                ) : (
                  'Not confirmed'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-content-muted dark:text-content-muted-dark">
                Last sign-in
              </dt>
              <dd className="mt-0.5 text-content dark:text-content-dark">
                {user?.last_sign_in_at
                  ? new Date(user.last_sign_in_at).toLocaleString('en-GB')
                  : '-'}
              </dd>
            </div>
          </dl>
        </SettingsSection>

        <TwoFactorSection />
      </div>
    </div>
  );
}
