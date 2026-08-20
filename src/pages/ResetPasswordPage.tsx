import { useEffect, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/useToast';
import { reportError } from '@/lib/sentry';
import { authErrorMessage } from '@/lib/authErrors';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

/**
 * `/reset-password`, where the recovery link lands.
 *
 * Supabase turns the recovery token in the URL into a real session before this
 * component mounts, and fires a PASSWORD_RECOVERY event. So the page cannot
 * simply check "is there a session" to decide whether the link was valid: it
 * waits for that event (or an already-established session) and otherwise tells
 * the user the link is stale rather than showing a form that cannot submit.
 */
export function ResetPasswordPage(): JSX.Element {
  const navigate = useNavigate();
  const { showSuccess } = useToast();

  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setReady(true);
        setChecking(false);
      }
    });

    // The event may already have fired before this listener attached.
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) setReady(true);
      setChecking(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleUpdate = async (): Promise<void> => {
    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      showSuccess('Password updated. You are signed in.');
      void navigate('/app/dashboard', { replace: true });
    } catch (err) {
      reportError(err, { area: 'auth:reset-password' });
      setError(authErrorMessage(err, 'Could not update the password.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <Card className="w-full max-w-sm animate-fade-up motion-reduce:animate-none">
        <h1 className="mb-1 font-display text-2xl text-content dark:text-content-dark">
          Set a new password
        </h1>

        {checking ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Checking your link…
          </p>
        ) : !ready ? (
          <>
            <p className="mb-6 text-sm text-content-muted dark:text-content-muted-dark">
              This reset link is invalid or has expired. Request a new one. Links are
              valid for one hour.
            </p>
            <Button className="w-full" onClick={() => void navigate('/forgot-password')}>
              Request a new link
            </Button>
          </>
        ) : (
          <>
            <p className="mb-6 text-sm text-content-muted dark:text-content-muted-dark">
              Choose a new password for your account.
            </p>

            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              className="mb-4"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />

            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              className="mb-5"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)}
              placeholder="Repeat the password"
            />

            <Button
              className="w-full"
              disabled={busy || password.length < 8 || confirm.length < 8}
              onClick={() => void handleUpdate()}
            >
              {busy ? 'Saving…' : 'Update password'}
            </Button>

            {error && (
              <p className="mt-4 text-sm text-danger" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </Card>
    </main>
  );
}
