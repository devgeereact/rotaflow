import { useState, type ChangeEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/sentry';
import { env, type OAuthProvider } from '@/lib/env';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

type Provider = OAuthProvider;

const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: 'Google',
  github: 'GitHub',
};

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/app/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const redirectTo = env.appUrl || window.location.origin;

  const withBusy = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (error) {
      reportError(error, { area: 'login' });
      setMessage(error instanceof Error ? error.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const signInWithPassword = (): Promise<void> =>
    withBusy(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate(from, { replace: true });
    });

  const signUp = (): Promise<void> =>
    withBusy(async () => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setMessage('Check your email to confirm your account.');
    });

  const signInWithOAuth = (provider: Provider): Promise<void> =>
    withBusy(async () => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      });
      if (error) throw error;
    });

  const signInWithMagicLink = (): Promise<void> =>
    withBusy(async () => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setMessage('Magic link sent — check your inbox.');
    });

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <Card className="w-full max-w-sm animate-fade-up">
        <h1 className="mb-1 font-display text-2xl text-content dark:text-content-dark">
          Welcome back
        </h1>
        <p className="mb-6 text-sm text-content-muted dark:text-content-muted-dark">
          Sign in to continue.
        </p>

        <label
          className="mb-1 block text-sm text-content-muted dark:text-content-muted-dark"
          htmlFor="email"
        >
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
          placeholder="you@example.com"
        />

        <label
          className="mb-1 block text-sm text-content-muted dark:text-content-muted-dark"
          htmlFor="password"
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
          className="mb-5 w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
          placeholder="••••••••"
        />

        <div className="flex gap-3">
          <Button
            className="flex-1"
            disabled={busy}
            onClick={() => void signInWithPassword()}
          >
            Sign in
          </Button>
          <Button
            className="flex-1"
            variant="ghost"
            disabled={busy}
            onClick={() => void signUp()}
          >
            Sign up
          </Button>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void signInWithMagicLink()}
          className="mt-4 w-full text-sm text-secondary underline-offset-4 hover:underline disabled:opacity-50 dark:text-secondary-dark"
        >
          Email me a magic link instead
        </button>

        {/* Only providers actually enabled in Supabase — see env.oauthProviders. */}
        {env.oauthProviders.length > 0 && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs text-content-muted dark:text-content-muted-dark">
              <span className="h-px flex-1 bg-surface-border dark:bg-surface-border-dark" />{' '}
              OR{' '}
              <span className="h-px flex-1 bg-surface-border dark:bg-surface-border-dark" />
            </div>

            <div className="flex gap-3">
              {env.oauthProviders.map((provider) => (
                <Button
                  key={provider}
                  className="flex-1"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void signInWithOAuth(provider)}
                >
                  Continue with {PROVIDER_LABELS[provider]}
                </Button>
              ))}
            </div>
          </>
        )}

        {message && (
          <p
            role="status"
            className="mt-4 text-center text-sm text-content-muted dark:text-content-muted-dark"
          >
            {message}
          </p>
        )}
      </Card>
    </main>
  );
}
