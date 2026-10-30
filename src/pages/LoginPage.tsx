import type { JSX } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AUTH_FEATURES } from '@/lib/marketing';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { ClerkAuthPanel } from '@/components/auth/ClerkAuthPanel';

/** `/login` and its Clerk sub-steps (`/login/*`): docs/design/signin.png, with Clerk's email-code form. */
export function LoginPage(): JSX.Element {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  // Only an in-app path may be a return target, never another origin.
  const redirectTo = from?.startsWith('/app') ? from : '/app/dashboard';

  return (
    <AuthSplitLayout
      headline="Scheduling certainty"
      headlineAccent="for every shift."
      description="Build rotas with fewer surprises, keep staff informed, and keep a record of every clock-in. A clock-in made with no signal waits on the phone until it returns."
      features={AUTH_FEATURES}
    >
      <div className="w-full max-w-2xl animate-fade-up motion-reduce:animate-none rounded-2xl border border-surface-border bg-surface p-9 shadow dark:border-surface-border-dark dark:bg-surface-dark md:p-11">
        <h1 className="mb-1 font-display text-3xl font-bold text-ink dark:text-content-dark">
          Welcome back
        </h1>
        <p className="mb-6 text-ink-muted dark:text-content-muted-dark">
          Sign in with the email address your organisation invited. We send you a code;
          there is no password to remember.
        </p>
        <ClerkAuthPanel mode="sign-in" redirectTo={redirectTo} />
        <p className="mt-6 text-sm text-ink-muted dark:text-content-muted-dark">
          New to RotaFlow?{' '}
          <Link
            to="/signup"
            className="font-medium text-brand underline-offset-2 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </div>
    </AuthSplitLayout>
  );
}
