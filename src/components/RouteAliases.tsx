import { useEffect } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AppBootScreen } from '@/components/AppBootScreen';

/**
 * Redirects for the paths the build spec names that differ from the ones this
 * app was built on.
 *
 * The spec's route table asks for `/app/team/:staffId`, `/app/clock-in` and
 * `/app/profile/*`; the app has `/app/staff/:staffId`, `/app/clock` and
 * `/app/account/*`. Renaming the built routes would break every existing
 * bookmark, every link already sent to staff, and the `navigationTargets` test
 * that pins the nav to the route table. Aliasing costs nothing and means both
 * spellings resolve.
 */

/** `/app/team/:staffId` → `/app/staff/:staffId`. */
export function TeamMemberRedirect(): JSX.Element {
  const { staffId } = useParams<{ staffId: string }>();
  return <Navigate to={`/app/staff/${staffId ?? ''}`} replace />;
}

/** `/app/profile/<tab>` → `/app/account/<tab>`, preserving the tab. */
export function ProfileRedirect(): JSX.Element {
  const params = useParams();
  const rest = params['*'] ?? '';
  /*
   * The spec calls the first tab "personal"; this app calls it "profile".
   * Every other tab name matches, so only that one needs translating —
   * mapping the whole set would be a table that has to be kept in sync with
   * `PROFILE_TABS` for no benefit.
   */
  const tab = rest === 'personal' ? 'profile' : rest;
  return <Navigate to={`/app/account${tab ? `/${tab}` : ''}`} replace />;
}

/**
 * `/auth/callback` — where an OAuth provider or a magic link may return.
 *
 * Sign-in already sets `redirectTo` straight at `/app/dashboard`, so nothing
 * in this app routes here today. It exists because the redirect target is
 * configured in the Supabase dashboard, not only in this code: if that
 * allowlist is ever changed to the conventional `/auth/callback` — or a
 * provider is added whose console has it prefilled — the user lands on a route
 * that must not be the 404 page while holding a valid session in the URL hash.
 *
 * The Supabase client parses the hash itself on load, so this only has to wait
 * a tick and then get out of the way.
 */
export function AuthCallbackPage(): JSX.Element {
  const navigate = useNavigate();

  useEffect(() => {
    // `replace`, so the callback URL — which carries the token in its hash —
    // never becomes a back-button destination.
    void navigate('/app/dashboard', { replace: true });
  }, [navigate]);

  return <AppBootScreen authResolved={false} orgResolved={false} />;
}
