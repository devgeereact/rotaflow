import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useOrg } from '@/hooks/useOrg';
import { useToast } from '@/hooks/useToast';
import {
  acceptInvite,
  previewInvite,
  type InvitePreview,
} from '@/services/inviteService';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SplashScreen } from '@/components/SplashScreen';
import logo from '@/assets/logo.png';

const ROLE_LABELS: Record<string, string> = {
  owner: 'an owner',
  manager: 'a manager',
  staff: 'a team member',
};

/**
 * Landing page for `/invite/:token`.
 *
 * Reachable signed out on purpose — `preview_invite` is granted to `anon` so
 * the invitee can see who invited them before deciding to create an account.
 * Redemption itself always requires a session, and the database additionally
 * requires the signed-in email to match the invited address, so a forwarded
 * link cannot be used by someone else.
 */
export function AcceptInvitePage(): JSX.Element {
  const { token = '' } = useParams<{ token: string }>();
  const { user, loading: authLoading } = useSupabaseAuth();
  const { refresh, switchOrg } = useOrg();
  const { showError, showSuccess } = useToast();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const result = await previewInvite(token);
        if (!active) return;
        setPreview(result);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'invite:preview' });
        setError('We could not check this invitation. Please try again.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const handleAccept = useCallback(async (): Promise<void> => {
    setAccepting(true);
    setError(null);
    try {
      const orgId = await acceptInvite(token);
      await refresh();
      switchOrg(orgId);
      showSuccess(`You've joined ${preview?.orgName ?? 'the organisation'}.`);
      void navigate('/app/dashboard', { replace: true });
    } catch (err) {
      reportError(err, { area: 'invite:accept' });
      // The database raises specific, user-safe messages for the cases that
      // matter (wrong email, expired, revoked, already used) — surfacing them
      // verbatim is more useful than a generic failure.
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'This invitation could not be accepted.';
      setError(message);
      showError(message);
    } finally {
      setAccepting(false);
    }
  }, [token, refresh, switchOrg, preview, navigate, showError, showSuccess]);

  if (loading || authLoading) return <SplashScreen />;

  const shell = (children: React.ReactNode): JSX.Element => (
    <main className="grid min-h-screen place-items-center px-6">
      <Card className="w-full max-w-sm animate-fade-up text-center">
        <img src={logo} alt="RotaFlow" className="mx-auto mb-6 h-14 w-14" />
        {children}
      </Card>
    </main>
  );

  if (!preview) {
    return shell(
      <>
        <h1 className="mb-1 font-display text-2xl text-content dark:text-content-dark">
          This invitation isn&rsquo;t valid
        </h1>
        <p className="mb-6 text-sm text-content-muted dark:text-content-muted-dark">
          {error ??
            'It may have expired, been revoked, or already been used. Ask whoever invited you to send a new one.'}
        </p>
        <Link to="/login">
          <Button className="w-full">Go to sign in</Button>
        </Link>
      </>,
    );
  }

  const roleLabel = ROLE_LABELS[preview.role] ?? `a ${preview.role}`;
  const wrongAccount =
    user !== null && user.email?.toLowerCase() !== preview.email.toLowerCase();

  return shell(
    <>
      <h1 className="mb-1 font-display text-2xl text-content dark:text-content-dark">
        Join {preview.orgName}
      </h1>
      <p className="mb-6 text-sm text-content-muted dark:text-content-muted-dark">
        You&rsquo;ve been invited to join <strong>{preview.orgName}</strong> as{' '}
        {roleLabel}, at <strong>{preview.email}</strong>.
      </p>

      {user === null ? (
        <>
          <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
            Sign in or create an account with that address to accept.
          </p>
          {/* Carry the token so the confirmation email returns here, not to
              the dashboard — otherwise confirming strands the invitee. */}
          <Link
            to={`/signup?email=${encodeURIComponent(preview.email)}&invite=${encodeURIComponent(token)}`}
          >
            <Button className="mb-3 w-full">Create an account</Button>
          </Link>
          <Link to="/login">
            <Button variant="ghost" className="w-full">
              I already have an account
            </Button>
          </Link>
        </>
      ) : wrongAccount ? (
        <>
          <p className="mb-4 text-sm text-danger" role="alert">
            You&rsquo;re signed in as <strong>{user.email}</strong>, but this invitation
            was sent to <strong>{preview.email}</strong>. Sign out and sign back in with
            that address to accept it.
          </p>
          <Link to="/login">
            <Button variant="ghost" className="w-full">
              Switch account
            </Button>
          </Link>
        </>
      ) : (
        <>
          <Button
            className="w-full"
            onClick={() => void handleAccept()}
            disabled={accepting}
          >
            {accepting ? 'Joining…' : `Accept and join ${preview.orgName}`}
          </Button>
          {error && (
            <p className="mt-4 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </>,
  );
}
