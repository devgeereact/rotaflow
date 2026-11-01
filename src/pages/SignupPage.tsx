import type { JSX } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AUTH_FEATURES } from '@/lib/marketing';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { ClerkAuthPanel } from '@/components/auth/ClerkAuthPanel';

/**
 * `/signup` and its Clerk sub-steps (`/signup/*`): docs/design/signup.png, with Clerk's email-code form.
 *
 * Anyone may create an account, but organisations are by invitation only (docs/MERGE-TARGET.md section 6): an
 * account with no invitation lands on the no-organisation screen. `?invite=<token>` returns the person to their
 * invitation once the account exists.
 */
export function SignupPage(): JSX.Element {
  const [params] = useSearchParams();
  const inviteToken = params.get('invite');
  const redirectTo = inviteToken
    ? `/invite/${encodeURIComponent(inviteToken)}`
    : '/app/dashboard';

  return (
    <AuthSplitLayout
      headline="Create your account."
      headlineAccent="Build a stronger team."
      description="Create a RotaFlow account for clearer rotas, reliable attendance and better-informed teams."
      features={AUTH_FEATURES}
    >
      <div className="w-full max-w-md animate-fade-up motion-reduce:animate-none rounded-2xl border border-surface-border bg-surface p-5 shadow dark:border-surface-border-dark dark:bg-surface-dark sm:p-9">
        <h1 className="mb-1 font-display text-3xl font-bold text-ink dark:text-content-dark">
          Create your account
        </h1>
        <p className="mb-6 text-ink-muted dark:text-content-muted-dark">
          {inviteToken
            ? 'Accept your invitation by creating an account with the email address it was sent to.'
            : 'Use the email address your organisation invited. We send you a code to confirm it.'}
        </p>
        <ClerkAuthPanel mode="sign-up" redirectTo={redirectTo} />
        <p className="mt-6 text-sm text-ink-muted dark:text-content-muted-dark">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-brand underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </AuthSplitLayout>
  );
}
