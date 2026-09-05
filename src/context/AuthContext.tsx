/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { clearTenantState } from '@/lib/session';
import { reportError } from '@/lib/sentry';

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

// null = "not inside a provider"; the hook guards against this.
export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Whose data the caches currently hold. Compared against every auth event so
  // a *change* of identity tears down, and an ordinary token refresh — which
  // fires TOKEN_REFRESHED with the same user, roughly hourly — does not.
  const cachedUserId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    // 1) Resolve any persisted session on first load.
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      cachedUserId.current = data.session?.user.id ?? null;
      setSession(data.session);
      setLoading(false);
    });

    // 2) Keep in sync with sign-in / sign-out / token refresh.
    //
    // RF-12. This used to do nothing but `setSession`, so `clearTenantState`
    // ran only in the `signOut` wrapper below — the one path a user takes
    // deliberately. Every other way a session ends went through here and left
    // the previous person's cached REST responses and staff photos in place:
    // an expired token, a session revoked from another device, an admin
    // signing the account out, or a second account signing in on the same
    // browser. On a ward tablet or a site office PC — most of RotaFlow's
    // market — the next person to sign in could be served the last one's
    // tenant data out of the `supabase-api` cache, which is keyed by URL and
    // not by user.
    //
    // Teardown is keyed on the user id changing rather than on the event name.
    // The event vocabulary has grown before, and a SIGNED_OUT-only check
    // silently misses a session *replacement*, which is the case that actually
    // discloses one tenant's data to another.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      const nextUserId = next?.user.id ?? null;
      if (nextUserId !== cachedUserId.current) {
        cachedUserId.current = nextUserId;
        // Deliberately not awaited: this callback is synchronous and blocking
        // it would delay the re-render that takes the old user's screen away.
        // The queued outbox is untouched by design — see lib/session.ts.
        void clearTenantState().catch((err: unknown) =>
          reportError(err, { area: 'auth:identity-change' }),
        );
      }
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signOut: async () => {
        // Local teardown runs in `finally` on purpose: signing out offline (or
        // against an expired token) rejects here, and leaving the previous
        // user's cached tenant data on a shared device is the worse outcome.
        try {
          await supabase.auth.signOut();
        } finally {
          await clearTenantState().catch((err: unknown) =>
            reportError(err, { area: 'auth:clear-tenant-state' }),
          );
        }
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
