import { useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/sentry';
import { env } from '@/lib/env';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

type Provider = 'google' | 'github';

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
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
      navigate('/dashboard');
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
        <h1 className="mb-1 font-display text-2xl text-content">Welcome back</h1>
        <p className="mb-6 text-sm text-content-muted">Sign in to continue.</p>

        <label className="mb-1 block text-sm text-content-muted" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none focus-visible:ring-2 focus-visible:ring-primary"
          placeholder="you@example.com"
        />

        <label className="mb-1 block text-sm text-content-muted" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
          className="mb-5 w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none focus-visible:ring-2 focus-visible:ring-primary"
          placeholder="••••••••"
        />

        <div className="flex gap-3">
          <Button className="flex-1" disabled={busy} onClick={() => void signInWithPassword()}>
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
          className="mt-4 w-full text-sm text-secondary underline-offset-4 hover:underline disabled:opacity-50"
        >
          Email me a magic link instead
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-content-muted">
          <span className="h-px flex-1 bg-surface-border" /> OR <span className="h-px flex-1 bg-surface-border" />
        </div>

        <div className="flex gap-3">
          <Button
            className="flex-1"
            variant="ghost"
            disabled={busy}
            onClick={() => void signInWithOAuth('google')}
          >
            Google
          </Button>
          <Button
            className="flex-1"
            variant="ghost"
            disabled={busy}
            onClick={() => void signInWithOAuth('github')}
          >
            GitHub
          </Button>
        </div>

        {message && (
          <p role="status" className="mt-4 text-center text-sm text-content-muted">
            {message}
          </p>
        )}
      </Card>
    </main>
  );
}
