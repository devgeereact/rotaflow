import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/sentry';
import { appUrlFor } from '@/lib/appOrigin';
import { isValidEmail } from '@/lib/email';
import { usePageMetadata } from '@/hooks/usePageMetadata';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { EmailSuggestion } from '@/components/auth/EmailSuggestion';

/**
 * `/forgot-password`. Sends a recovery link.
 *
 * The confirmation message is deliberately identical whether or not the
 * address has an account. Saying "no account with that email" would turn this
 * form into an account-enumeration oracle for a system holding staff records.
 */
export function ForgotPasswordPage(): JSX.Element {
  // Title, description and canonical from `publicRoutes.ts`. Neither of these
  // two set any until 2026-09-02: the tab read the homepage's headline.
  usePageMetadata();

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSend = async (): Promise<void> => {
    if (!isValidEmail(email)) {
      setError('That does not look like a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: appUrlFor('/reset-password') },
      );
      if (resetError) throw resetError;
      setSent(true);
    } catch (err) {
      reportError(err, { area: 'auth:forgot-password' });
      setError('Could not send the reset link. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <Card className="w-full max-w-sm animate-fade-up motion-reduce:animate-none">
        <h1 className="mb-1 font-display text-2xl text-content dark:text-content-dark">
          Reset your password
        </h1>

        {sent ? (
          <>
            <p className="mb-6 text-sm text-content-muted dark:text-content-muted-dark">
              If an account exists for <strong>{email.trim()}</strong>, a reset link is on
              its way. The link expires in one hour.
            </p>
            <Link to="/login">
              <Button className="w-full">Back to sign in</Button>
            </Link>
          </>
        ) : (
          <>
            <p className="mb-6 text-sm text-content-muted dark:text-content-muted-dark">
              Enter your email and we&rsquo;ll send you a link to set a new password.
            </p>

            {/* A real <form>, so Enter submits — see LoginPage for why none of
                these four screens had one until 2026-09-02. */}
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (busy || !email.trim()) return;
                void handleSend();
              }}
            >
              <Label htmlFor="forgot-email">Email</Label>
              <div className="mb-5">
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  // The error below is the only thing that explains a refused
                  // submit, and it sat at the bottom of the card as an
                  // unassociated paragraph: announced once, and then
                  // unreachable from the field it is about.
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'forgot-error' : undefined}
                  value={email}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setEmail(e.target.value)
                  }
                  placeholder="you@example.com"
                />
                <EmailSuggestion email={email} onAccept={setEmail} />
              </div>

              <Button type="submit" className="w-full" disabled={busy || !email.trim()}>
                {busy ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>

            {error && (
              <p
                id="forgot-error"
                className="mt-4 text-sm text-danger-ink dark:text-danger-ink-dark"
                role="alert"
              >
                {error}
              </p>
            )}

            <p className="mt-6 text-center text-sm text-content-muted dark:text-content-muted-dark">
              <Link
                to="/login"
                className="text-secondary underline-offset-4 hover:underline dark:text-secondary-dark"
              >
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </Card>
    </main>
  );
}
