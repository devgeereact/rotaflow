import { useState, type ChangeEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/sentry';
import { authErrorMessage } from '@/lib/authErrors';
import { isValidEmail } from '@/lib/email';
import { env, type OAuthProvider } from '@/lib/env';
import { appUrlFor } from '@/lib/appOrigin';
import { AUTH_FEATURES } from '@/lib/marketing';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { EmailSuggestion } from '@/components/auth/EmailSuggestion';

/** `/login` (docs/design/signin.png). */
export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/app/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // OAuth/magic-link both bounce through Supabase and back. Send them
  // straight at the app, not the bare origin, or a signed-in user lands back
  // on the marketing homepage instead of the dashboard/onboarding.
  //
  // `appUrlFor` resolves the *current* origin, so this returns to whichever
  // host you signed in from. It used to prefer `VITE_APP_URL`, which sent
  // every localhost sign-in to production (see lib/appOrigin.ts).
  const redirectTo = appUrlFor('/app/dashboard');

  const withBusy = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      reportError(err, { area: 'login' });
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const signInWithPassword = (): Promise<void> =>
    withBusy(async () => {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      void navigate(from, { replace: true });
    });

  const signInWithOAuth = (provider: OAuthProvider): Promise<void> =>
    withBusy(async () => {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      });
      if (oauthError) throw oauthError;
    });

  const signInWithMagicLink = (): Promise<void> => {
    if (!email.trim()) {
      setError('Enter your email address first.');
      return Promise.resolve();
    }
    if (!isValidEmail(email)) {
      setError('That does not look like a valid email address.');
      return Promise.resolve();
    }
    return withBusy(async () => {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: redirectTo,
          // This is the sign-IN page: never create an account from a typo.
          // The client default is `true` (verified in auth-js
          // GoTrueClient.js: `create_user: options?.shouldCreateUser ?? true`),
          // which silently registered an orphan user for every mistyped
          // address AND mailed a hard-bouncing mailbox. Signing up via magic
          // link is still possible, on /signup, where it's intended.
          shouldCreateUser: false,
        },
      });
      if (otpError) throw otpError;
      // Deliberately conditional. `shouldCreateUser: false` above means an
      // address with no account gets **no email at all**, and Supabase still
      // returns success. It will not confirm whether an account exists, and
      // it is right not to. Claiming "sent" is then simply false, and it is
      // the single most confusing thing this screen could say: the reader
      // waits for a mail that was never going to arrive. This wording keeps
      // the anti-enumeration property and still points a new user at signup.
      setMessage(
        'If an account exists for that address, a magic link is on its way. Check your inbox. New to RotaFlow? Create an account first.',
      );
    });
  };

  const canSubmit = !busy && email.trim().length > 0 && password.length > 0;

  return (
    <AuthSplitLayout
      headline="Scheduling certainty"
      headlineAccent="for every shift."
      description="Build rotas with fewer surprises, keep staff informed, and keep a dependable attendance record — even when the signal drops."
      features={AUTH_FEATURES}
    >
      <div className="w-full max-w-2xl animate-fade-up motion-reduce:animate-none rounded-2xl border border-surface-border bg-surface p-9 shadow dark:border-surface-border-dark dark:bg-surface-dark md:p-11">
        <h1 className="mb-1 font-display text-3xl font-bold text-ink dark:text-content-dark">
          Welcome back
        </h1>
        <p className="mb-6 text-ink-muted dark:text-content-muted-dark">
          Sign in to your RotaFlow account
        </p>

        <div className="mb-6">
          <Label htmlFor="login-email">Email address</Label>
          <Input
            id="login-email"
            type="email"
            icon={Mail}
            autoComplete="email"
            value={email}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            placeholder="Enter your email"
          />
          <EmailSuggestion email={email} onAccept={setEmail} />
        </div>

        <div className="mb-2">
          <Label htmlFor="login-password">Password</Label>
          <Input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            icon={Lock}
            autoComplete="current-password"
            value={password}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            placeholder="Enter your password"
            endAdornment={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="grid h-7 w-7 place-items-center rounded-md text-content-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark dark:hover:text-content-dark"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            }
          />
        </div>

        <p className="mb-6 text-right text-sm">
          <Link
            to="/forgot-password"
            className="font-medium text-primary-ink hover:underline dark:text-primary"
          >
            Forgot password?
          </Link>
        </p>

        <Button
          className="w-full bg-brand hover:bg-brand/90 dark:bg-brand"
          size="lg"
          disabled={!canSubmit}
          onClick={() => void signInWithPassword()}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>

        {env.oauthProviders.length > 0 && (
          <>
            <div className="my-6 flex items-center gap-3 text-sm text-content-muted dark:text-content-muted-dark">
              <span className="h-px flex-1 bg-surface-border dark:bg-surface-border-dark" />
              or continue with
              <span className="h-px flex-1 bg-surface-border dark:bg-surface-border-dark" />
            </div>

            <OAuthButtons
              providers={env.oauthProviders}
              busy={busy}
              onSelect={(provider) => void signInWithOAuth(provider)}
            />
          </>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={() => void signInWithMagicLink()}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-surface-border bg-surface text-sm font-medium text-primary transition-transform duration-150 ease-in-out active:scale-[0.98] hover:scale-[1.02] hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 dark:border-surface-border-dark dark:bg-surface-dark dark:hover:bg-surface-subtle-dark"
        >
          <Mail size={18} aria-hidden="true" />
          Sign in with magic link
        </button>

        {error && (
          <p className="mt-4 text-center text-sm text-danger" role="alert">
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

        <p className="mt-6 text-center text-sm text-ink-muted dark:text-content-muted-dark">
          Don&rsquo;t have an account?{' '}
          <Link
            to="/signup"
            className="font-medium text-primary-ink hover:underline dark:text-primary"
          >
            Sign up
          </Link>
        </p>
      </div>
    </AuthSplitLayout>
  );
}
