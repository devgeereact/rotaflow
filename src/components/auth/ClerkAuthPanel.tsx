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
  // Style objects, not class names: Clerk's own CSS outranks Tailwind
  // utilities, so the classes this used to pass were ignored and the card,
  // its shadow and its heading all still rendered.
  elements: {
    // Clerk's card has a fixed 25rem width; on a 390 px phone inside the
    // page's own card it scrolled the page sideways by 82 px (design gap F11).
    rootBox: { width: '100%', minWidth: 0 },
    cardBox: {
      width: '100%',
      maxWidth: '100%',
      minWidth: 0,
      boxShadow: 'none',
      border: 'none',
      overflow: 'visible',
    },
    card: {
      width: '100%',
      boxShadow: 'none',
      border: 'none',
      background: 'transparent',
      padding: '2px',
      overflow: 'visible',
    },
    // The page already has the heading and the one secondary link; Clerk's
    // copies made a second card and a second sign-up route (F12, F13).
    header: { display: 'none' },
    footerAction: { display: 'none' },
    footer: { background: 'transparent' },
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
