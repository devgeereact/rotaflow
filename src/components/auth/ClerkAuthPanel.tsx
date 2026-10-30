import type { JSX } from 'react';
import { SignIn, SignUp } from '@clerk/clerk-react';
import { env } from '@/lib/env';

/**
 * Clerk's own sign-in and sign-up forms inside RotaFlow's auth card.
 *
 * Clerk owns the whole flow: the email code, any second factor, connected accounts and session management. RotaFlow
 * keeps no passwords and no sign-in state of its own. The appearance follows the design tokens so the form reads as
 * part of the page rather than an embed.
 */
const APPEARANCE = {
  variables: {
    colorPrimary: 'var(--color-brand, #1f5eff)',
    borderRadius: '0.75rem',
    fontFamily: 'inherit',
  },
  elements: {
    rootBox: 'w-full',
    cardBox: 'w-full shadow-none',
    card: 'w-full shadow-none border-0 bg-transparent p-0',
  },
} as const;

export function ClerkAuthPanel({
  mode,
  redirectTo = '/app/dashboard',
}: {
  mode: 'sign-in' | 'sign-up';
  redirectTo?: string;
}): JSX.Element {
  if (!env.clerkPublishableKey) {
    return (
      <p role="alert" className="text-ink-muted dark:text-content-muted-dark">
        Sign-in is not available in this build. Set VITE_CLERK_PUBLISHABLE_KEY and
        rebuild.
      </p>
    );
  }
  return mode === 'sign-in' ? (
    <SignIn
      routing="path"
      path="/login"
      signUpUrl="/signup"
      fallbackRedirectUrl={redirectTo}
      appearance={APPEARANCE}
    />
  ) : (
    <SignUp
      routing="path"
      path="/signup"
      signInUrl="/login"
      fallbackRedirectUrl={redirectTo}
      appearance={APPEARANCE}
    />
  );
}
