import { useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/sentry';
import { env } from '@/lib/env';
import { buildAcceptUrl } from '@/services/inviteService';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

/**
 * Standalone `/signup`, previously only a toggle inside LoginPage.
 *
 * Carries an invite through the whole round trip. An invitee arriving from
 * `/invite/:token` gets their address pre-filled and locked, and the email
 * confirmation link points back at the invite rather than the dashboard —
 * otherwise confirming the account strands them with no way back to the
 * invitation they were trying to accept.
 */
export function SignupPage(): JSX.Element {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const invitedEmail = params.get('email') ?? '';
  const inviteToken = params.get('invite');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const redirectTo = inviteToken
    ? buildAcceptUrl(inviteToken)
    : env.appUrl || window.location.origin;

  const handleSignUp = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: { full_name: fullName.trim() || null },
        },
      });
      if (signUpError) throw signUpError;

      // With email confirmation on, signUp returns a user but no session.
      if (data.session) {
        navigate(inviteToken ? `/invite/${inviteToken}` : '/app/dashboard', {
          replace: true,
        });
        return;
      }
      setMessage(
        inviteToken
          ? 'Check your email to confirm your account — the link brings you straight back to this invitation.'
          : 'Check your email to confirm your account.',
      );
    } catch (err) {
      reportError(err, { area: 'signup' });
      setError(err instanceof Error ? err.message : 'Could not create that account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <Card className="w-full max-w-sm animate-fade-up">
        <h1 className="mb-1 font-display text-2xl text-content dark:text-content-dark">
          Create your account
        </h1>
        <p className="mb-6 text-sm text-content-muted dark:text-content-muted-dark">
          {inviteToken
            ? 'Accept your invitation by creating an account.'
            : 'Get started with RotaFlow.'}
        </p>

        <Label htmlFor="signup-name">Full name</Label>
        <Input
          id="signup-name"
          className="mb-4"
          autoComplete="name"
          value={fullName}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setFullName(e.target.value)}
          placeholder="Alex Morgan"
        />

        <Label htmlFor="signup-email">Email</Label>
        <Input
          id="signup-email"
          className="mb-1"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          placeholder="you@example.com"
          // An invite is bound to one address in the database; letting it be
          // edited here would only produce a confusing rejection at redemption.
          readOnly={Boolean(inviteToken && invitedEmail)}
        />
        {inviteToken && invitedEmail && (
          <p className="mb-4 text-xs text-content-muted dark:text-content-muted-dark">
            This invitation can only be accepted with this address.
          </p>
        )}
        {!(inviteToken && invitedEmail) && <div className="mb-4" />}

        <Label htmlFor="signup-password">Password</Label>
        <Input
          id="signup-password"
          className="mb-5"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
        />

        <Button
          className="w-full"
          disabled={busy || !email.trim() || password.length < 8}
          onClick={() => void handleSignUp()}
        >
          {busy ? 'Creating…' : 'Create account'}
        </Button>

        {error && (
          <p className="mt-4 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p
            role="status"
            className="mt-4 text-center text-sm text-content-muted dark:text-content-muted-dark"
          >
            {message}
          </p>
        )}

        <p className="mt-6 text-center text-sm text-content-muted dark:text-content-muted-dark">
          Already have an account?{' '}
          <Link
            to="/login"
            className="text-secondary underline-offset-4 hover:underline dark:text-secondary-dark"
          >
            Sign in
          </Link>
        </p>
      </Card>
    </main>
  );
}
