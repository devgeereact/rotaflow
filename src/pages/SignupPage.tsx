import { useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  Calendar,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/sentry';
import { env, type OAuthProvider } from '@/lib/env';
import { buildAcceptUrl } from '@/services/inviteService';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { AuthSplitLayout, type AuthFeature } from '@/components/auth/AuthSplitLayout';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { PasswordRequirements } from '@/components/auth/PasswordRequirements';
import { EmailSuggestion } from '@/components/auth/EmailSuggestion';
import { evaluatePassword } from '@/lib/password';
import { isValidEmail } from '@/lib/email';

const FEATURES: AuthFeature[] = [
  {
    icon: Calendar,
    title: 'Smart Scheduling',
    body: 'Create balanced rotas in minutes.',
  },
  {
    icon: Users,
    title: 'Happy Teams',
    body: 'Empower your team and improve satisfaction.',
  },
  {
    icon: ShieldCheck,
    title: 'Compliant & Secure',
    body: 'Stay compliant with confidence.',
  },
  {
    icon: BarChart3,
    title: 'Data Driven',
    body: 'Make better decisions with real-time insights.',
  },
];

/**
 * `/signup` (design/signup.png).
 *
 * Carries an invite through the whole round trip. An invitee arriving from
 * `/invite/:token` gets their address pre-filled and locked, and every
 * redirect (email confirmation, magic link, OAuth) points back at the invite
 * rather than the dashboard — otherwise finishing sign-up strands them with no
 * way back to the invitation they were trying to accept.
 */
export function SignupPage(): JSX.Element {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const invitedEmail = params.get('email') ?? '';
  const inviteToken = params.get('invite');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requirements = evaluatePassword(password);
  const passwordValid = requirements.every((r) => r.met);

  // OAuth/magic-link both bounce through Supabase and back — an invitee goes
  // back to their invitation, everyone else goes straight into the app, not
  // the bare origin, or a signed-in user lands back on the marketing
  // homepage instead of the dashboard/onboarding.
  const redirectTo = inviteToken
    ? buildAcceptUrl(inviteToken)
    : `${(env.appUrl || window.location.origin).replace(/\/$/, '')}/app/dashboard`;

  const withBusy = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      reportError(err, { area: 'signup' });
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignUp = (): Promise<void> =>
    withBusy(async () => {
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: { full_name: fullName || null },
        },
      });
      if (signUpError) throw signUpError;

      // With email confirmation on, signUp returns a user but no session.
      if (data.session) {
        void navigate(inviteToken ? `/invite/${inviteToken}` : '/app/dashboard', {
          replace: true,
        });
        return;
      }
      setMessage(
        inviteToken
          ? 'Check your email to confirm your account — the link brings you straight back to this invitation.'
          : 'Check your email to confirm your account.',
      );
    });

  const handleMagicLink = (): Promise<void> => {
    if (!email.trim()) {
      setError('Enter your email address first.');
      return Promise.resolve();
    }
    if (!isValidEmail(email)) {
      setError('That does not look like a valid email address.');
      return Promise.resolve();
    }
    // shouldCreateUser is left at its default (true) here, unlike on
    // /login — this is the signup page, so creating the account is the point.
    return withBusy(async () => {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo },
      });
      if (otpError) throw otpError;
      setMessage('Magic link sent — check your inbox.');
    });
  };

  const handleOAuth = (provider: OAuthProvider): Promise<void> =>
    withBusy(async () => {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      });
      if (oauthError) throw oauthError;
    });

  const emailLocked = Boolean(inviteToken && invitedEmail);
  const canSubmit =
    !busy &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    isValidEmail(email) &&
    passwordValid;

  return (
    <AuthSplitLayout
      headline="Create your account."
      headlineAccent="Build a stronger team."
      description="Join thousands of organisations using RotaFlow to schedule smarter and work better."
      features={FEATURES}
    >
      <div className="w-full max-w-3xl animate-fade-up rounded-2xl border border-surface-border bg-surface p-9 shadow dark:border-surface-border-dark dark:bg-surface-dark md:p-11">
        <h1 className="mb-1 font-display text-3xl font-bold text-ink dark:text-content-dark">
          Create your account
        </h1>
        <p className="mb-6 text-ink-muted dark:text-content-muted-dark">
          {inviteToken
            ? 'Accept your invitation by creating an account.'
            : 'Get started with your RotaFlow account'}
        </p>

        <div className="mb-5 grid grid-cols-2 gap-6">
          <div>
            <Label htmlFor="signup-first-name">First name</Label>
            <Input
              id="signup-first-name"
              icon={User}
              autoComplete="given-name"
              value={firstName}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setFirstName(e.target.value)
              }
              placeholder="Enter your first name"
            />
          </div>
          <div>
            <Label htmlFor="signup-last-name">Last name</Label>
            <Input
              id="signup-last-name"
              icon={User}
              autoComplete="family-name"
              value={lastName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setLastName(e.target.value)}
              placeholder="Enter your last name"
            />
          </div>
        </div>

        <div className="mb-6">
          <Label htmlFor="signup-email">Work email address</Label>
          <Input
            id="signup-email"
            type="email"
            icon={Mail}
            autoComplete="email"
            value={email}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            placeholder="Enter your work email"
            // An invite is bound to one address in the database; letting it be
            // edited here would only produce a confusing rejection at redemption.
            readOnly={emailLocked}
          />
          {!emailLocked && <EmailSuggestion email={email} onAccept={setEmail} />}
          {emailLocked && (
            <p className="mt-1.5 text-xs text-content-muted dark:text-content-muted-dark">
              This invitation can only be accepted with this address.
            </p>
          )}
        </div>

        <div className="mb-6">
          <Label htmlFor="signup-password">Password</Label>
          <Input
            id="signup-password"
            type={showPassword ? 'text' : 'password'}
            icon={Lock}
            autoComplete="new-password"
            value={password}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            placeholder="Create a strong password"
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
          <div className="mt-3">
            <PasswordRequirements requirements={requirements} />
          </div>
        </div>

        <Button
          className="w-full bg-brand hover:bg-brand/90 dark:bg-brand"
          size="lg"
          disabled={!canSubmit}
          onClick={() => void handleSignUp()}
        >
          {busy ? 'Creating account…' : 'Create account'}
        </Button>

        {env.oauthProviders.length > 0 && (
          <>
            <div className="my-6 flex items-center gap-3 text-sm text-content-muted dark:text-content-muted-dark">
              <span className="h-px flex-1 bg-surface-border dark:bg-surface-border-dark" />
              or sign up with
              <span className="h-px flex-1 bg-surface-border dark:bg-surface-border-dark" />
            </div>

            <OAuthButtons
              providers={env.oauthProviders}
              busy={busy}
              onSelect={(provider) => void handleOAuth(provider)}
            />
          </>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={() => void handleMagicLink()}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-surface-border bg-surface text-sm font-medium text-brand transition-transform duration-150 ease-in-out active:scale-[0.98] hover:scale-[1.02] hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 dark:border-surface-border-dark dark:bg-surface-dark dark:text-brand-light dark:hover:bg-surface-subtle-dark"
        >
          <Mail size={18} aria-hidden="true" />
          Sign up with magic link
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
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-brand hover:underline dark:text-brand-light"
          >
            Sign in
          </Link>
        </p>
      </div>
    </AuthSplitLayout>
  );
}
