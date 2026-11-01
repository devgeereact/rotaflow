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
      <div className="w-full max-w-md animate-fade-up motion-reduce:animate-none rounded-2xl border border-surface-border bg-surface p-5 shadow dark:border-surface-border-dark dark:bg-surface-dark sm:p-9">
        <h1 className="mb-1 font-display text-3xl font-bold text-ink dark:text-content-dark">
          Sign in to RotaFlow
        </h1>
        <p className="mb-6 text-ink-muted dark:text-content-muted-dark">
          Use the email your organisation invited. We send you a code, so there is no
          password to remember.
        </p>
        <ClerkAuthPanel mode="sign-in" redirectTo={redirectTo} />
        <p className="mt-6 text-sm text-ink-muted dark:text-content-muted-dark">
          {/* Organisations are by invitation (owner decision, 30 Oct 2026): an
              invitee arrives through their invite link, so the page offers no
              open sign-up route, only a way to ask (design gap F13). */}
          Setting up a new organisation?{' '}
          <Link
            to="/contact"
            className="font-medium text-primary-ink underline underline-offset-2 dark:text-primary-ink-dark"
          >
            Ask for access
          </Link>
        </p>
      </div>
    </AuthSplitLayout>
  );
}
