import { useCallback, useState, type ChangeEvent } from 'react';
import { CheckCircle2, Lock, ShieldAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { evaluatePassword } from '@/lib/password';
import { PasswordRequirements } from '@/components/auth/PasswordRequirements';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { SettingsSection } from '@/components/settings/SettingsSection';

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
 * - **Two-factor**. Supabase MFA is not enrolled anywhere in this app. A tick
 *   next to "Two-factor authentication" would be false.
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

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const requirements = evaluatePassword(newPassword);
  const passwordValid = requirements.every((r) => r.met);
  const passwordsMatch = newPassword === confirmPassword;

  const handleChangePassword = useCallback(async (): Promise<void> => {
    if (!passwordValid || !passwordsMatch) return;
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword('');
      setConfirmPassword('');
      showSuccess('Password changed.');
    } catch (err) {
      reportError(err, { area: 'account-security:change-password' });
      showError('Could not change your password. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [passwordValid, passwordsMatch, newPassword, showError, showSuccess]);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <SettingsSection
          title="Change password"
          description="You stay signed in on this device. Other sessions are ended."
        >
          <div className="max-w-md space-y-4">
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
              <p className="text-sm text-danger" role="alert">
                Those passwords do not match.
              </p>
            )}

            <Button
              onClick={() => void handleChangePassword()}
              disabled={saving || !passwordValid || !passwordsMatch}
            >
              {saving ? 'Changing…' : 'Change password'}
            </Button>
          </div>
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

        <Card className="bg-warning/5">
          <div className="flex gap-3">
            <ShieldAlert
              size={18}
              className="mt-0.5 shrink-0 text-warning"
              aria-hidden="true"
            />
            <div className="text-sm text-content-muted dark:text-content-muted-dark">
              <p className="font-medium text-content dark:text-content-dark">
                Two-factor authentication is not available yet
              </p>
              <p className="mt-1">
                RotaFlow does not support a second factor at sign-in. Your account is
                protected by your password alone. Use one you do not reuse anywhere else.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
