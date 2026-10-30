/* eslint-disable react-refresh/only-export-components */
import type { JSX } from 'react';
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ClerkProvider, useAuth as useClerkAuth } from '@clerk/clerk-react';
import { api, setApiAuth } from '@/lib/api';
import { env } from '@/lib/env';
import { clearTenantState, releasePushSubscription } from '@/lib/session';
import { deletePushSubscription } from '@/services/pushSubscriptionService';
import { reportError } from '@/lib/sentry';

/** The signed-in person as the API knows them. `id` is the API's user id, which memberships and staff records point at. */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

/** One organisation the person belongs to, as `GET /me` lists it. */
export interface MeMembership {
  org_id: string;
  name: string;
  slug: string;
  status: string;
  plan: string | null;
  membership_id: string;
  role: string;
  membership_status: string;
}

export interface MePayload {
  user: {
    id: string;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
  };
  memberships: MeMembership[];
  platform_role: string | null;
}

export interface AuthContextValue {
  /** Null when signed out, or signed in but `GET /me` could not be read (see `meFailed`). */
  user: AuthUser | null;
  /** True while Clerk loads or the first `GET /me` of a session is in flight. */
  loading: boolean;
  /** Clerk's verdict: there is a session in this browser. */
  signedIn: boolean;
  me: MePayload | null;
  /** Signed in, but the API could not say who this is. Shown as a retry card, never as "signed out". */
  meFailed: boolean;
  refreshMe: () => Promise<MePayload | null>;
  signOut: () => Promise<void>;
}

// null = "not inside a provider"; the hook guards against this.
export const AuthContext = createContext<AuthContextValue | null>(null);

function toUser(me: MePayload | null): AuthUser | null {
  if (!me?.user) return null;
  return {
    id: me.user.id,
    email: me.user.email,
    fullName: me.user.full_name,
    avatarUrl: me.user.avatar_url,
  };
}

async function loadMe(): Promise<MePayload> {
  try {
    return await api.get<MePayload>('/me');
  } catch (error) {
    // One retry after a short pause: the first read can race the session being established.
    reportError(error, { area: 'auth:me-retry' });
    await new Promise((resolve) => setTimeout(resolve, 600));
    return await api.get<MePayload>('/me');
  }
}

/** Lives inside `ClerkProvider`: turns Clerk's session into the app's `AuthContext`. */
function ClerkBridge({ children }: { children: ReactNode }): JSX.Element {
  const {
    isLoaded,
    isSignedIn,
    userId,
    getToken,
    signOut: clerkSignOut,
  } = useClerkAuth();
  const [me, setMe] = useState<MePayload | null>(null);
  const [meFor, setMeFor] = useState<string | null>(null);
  const [meFailed, setMeFailed] = useState(false);
  // Whose data the caches hold. A change of identity (including signing out) clears tenant state, so the next
  // person on a shared ward tablet is never served the last person's cached responses (RF-12).
  const cachedUserId = useRef<string | null>(null);

  useEffect(() => {
    setApiAuth(
      async () => (isSignedIn ? await getToken() : null),
      () => undefined,
    );
  }, [isSignedIn, getToken]);

  const refreshMe = useCallback(async (): Promise<MePayload | null> => {
    if (!isSignedIn || !userId) {
      setMe(null);
      setMeFailed(false);
      return null;
    }
    try {
      const next = await loadMe();
      setMe(next);
      setMeFailed(false);
      return next;
    } catch (error) {
      reportError(error, { area: 'auth:me' });
      setMeFailed(true);
      return null;
    } finally {
      setMeFor(userId);
    }
  }, [isSignedIn, userId]);

  useEffect(() => {
    if (!isLoaded) return;
    const next = isSignedIn ? (userId ?? null) : null;
    if (next !== cachedUserId.current) {
      const hadUser = cachedUserId.current !== null;
      cachedUserId.current = next;
      if (hadUser) {
        void clearTenantState().catch((err: unknown) =>
          reportError(err, { area: 'auth:identity-change' }),
        );
      }
    }
    void refreshMe();
  }, [isLoaded, isSignedIn, userId, refreshMe]);

  const signedIn = isLoaded && Boolean(isSignedIn);
  const loading = !isLoaded || (signedIn && meFor !== userId);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: signedIn ? toUser(me) : null,
      loading,
      signedIn,
      me: signedIn ? me : null,
      meFailed: signedIn && meFailed,
      refreshMe,
      signOut: async () => {
        // Push goes first, while the session can still delete its own subscription. It never throws.
        await releasePushSubscription(deletePushSubscription);
        try {
          await clerkSignOut();
        } finally {
          await clearTenantState().catch((err: unknown) =>
            reportError(err, { area: 'auth:clear-tenant-state' }),
          );
        }
      },
    }),
    [signedIn, me, loading, meFailed, refreshMe, clerkSignOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const SIGNED_OUT: AuthContextValue = {
  user: null,
  loading: false,
  signedIn: false,
  me: null,
  meFailed: false,
  refreshMe: () => Promise.resolve(null),
  signOut: () => clearTenantState(),
};

/**
 * Clerk is the sign-in (email code; MFA and connected accounts are managed in Clerk's own screens). A build without
 * `VITE_CLERK_PUBLISHABLE_KEY` (tests, a fork) renders the site signed out instead of failing at start-up; the
 * sign-in pages then say sign-in is unavailable.
 */
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  if (!env.clerkPublishableKey) {
    return <AuthContext.Provider value={SIGNED_OUT}>{children}</AuthContext.Provider>;
  }
  return (
    <ClerkProvider
      publishableKey={env.clerkPublishableKey}
      signInUrl="/login"
      signUpUrl="/signup"
      afterSignOutUrl="/login"
      signInFallbackRedirectUrl="/app"
      signUpFallbackRedirectUrl="/app"
    >
      <ClerkBridge>{children}</ClerkBridge>
    </ClerkProvider>
  );
}
