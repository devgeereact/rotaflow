import { useEffect, useState, type ReactNode } from 'react';
import { LogOut, RotateCw, ShieldAlert } from 'lucide-react';
import { AppBootScreen } from '@/components/AppBootScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MfaChallenge } from '@/components/auth/MfaChallenge';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useOrg } from '@/hooks/useOrg';
import { decideMfaStep, needsSecondFactor, type MfaStep } from '@/lib/mfaStep';
import { reportError } from '@/lib/sentry';
import { getMfaAssurance, listMfaFactors } from '@/services/mfaService';

type GateStep = MfaStep | { kind: 'error' };

interface Decision {
  userId: string;
  /** The access token the decision was made against. */
  token: string;
  step: GateStep;
}

/**
 * Holds protected content back until a session that owes a second factor has
 * given it (CAP-049).
 *
 * Lives inside `ProtectedRoute`, so `/app/*`, `/onboarding` and `/admin/*` all
 * pass through it, and `RequirePlatformAdmin` never renders for a session
 * still at `aal1` with a factor enrolled. Its platform-owner recovery path is
 * untouched: that is for an owner with NO verified factor, whose session is
 * `aal1` with `nextLevel` `aal1`, so it proceeds here and reaches the refusal
 * screen and its "turn off the requirement" button exactly as before.
 *
 * ## This is presentation, not the boundary
 *
 * Exactly as `RequirePlatformAdmin` says of itself. For the platform console
 * the boundary is `is_platform_admin()`, which demands `aal2` when
 * `require_mfa` is on (`0102`). Tenant data is guarded by membership RLS that
 * does not look at `aal`, so for an ordinary account this step is a UI gate:
 * it stops a person, not a script holding a stolen password.
 *
 * ## When it checks
 *
 * On every new access token, because a token is what carries the level. The
 * first version settled once per user and never asked again, which missed a
 * session being REPLACED for the same user without a sign-out in between: a
 * second tab signing in again with a password broadcasts an `aal1` session
 * into a tab already open at `aal2`, and that tab kept the app on screen.
 *
 * Re-checking must not unmount the app on the hourly token refresh, or it
 * would throw away whatever form somebody was half way through. So while a
 * newer token is being checked, a session that had already been admitted
 * stays admitted, and is replaced by the challenge only if the new token turns
 * out to owe one. Anything not already admitted waits on the boot screen.
 */
export function MfaGate({ children }: { children: ReactNode }): JSX.Element {
  const { session, signOut } = useSupabaseAuth();
  const { refresh } = useOrg();
  const userId = session?.user.id ?? null;
  const token = session?.access_token ?? null;

  const [decision, setDecision] = useState<Decision | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (userId === null || token === null) return;
    let active = true;
    void (async () => {
      try {
        const levels = await getMfaAssurance();
        const factors = needsSecondFactor(levels) ? await listMfaFactors() : [];
        if (active) setDecision({ userId, token, step: decideMfaStep(levels, factors) });
      } catch (err) {
        reportError(err, { area: 'mfa:gate-check' });
        // Fail closed. Admitting a session whose level could not be read is
        // exactly the bypass this gate exists to prevent.
        if (active) setDecision({ userId, token, step: { kind: 'error' } });
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, token, attempt]);

  // `ProtectedRoute` handles "no session"; nothing to hold back here.
  if (userId === null) return <>{children}</>;

  if (decision === null || decision.userId !== userId) {
    return <AppBootScreen authResolved={true} orgResolved={false} />;
  }

  if (decision.token !== token) {
    // A newer token for the same person is being checked. Keep an admitted
    // session on screen (a token refresh); hold anything else back.
    return decision.step.kind === 'proceed' ? (
      <>{children}</>
    ) : (
      <AppBootScreen authResolved={true} orgResolved={false} />
    );
  }

  const recheck = (): void => {
    setDecision(null);
    setAttempt((n) => n + 1);
  };

  switch (decision.step.kind) {
    case 'proceed':
      return <>{children}</>;

    case 'challenge':
      return (
        <MfaChallenge
          factors={decision.step.factors}
          defaultFactorId={decision.step.defaultFactorId}
          onVerified={() => {
            recheck();
            // `isPlatformAdmin` was read at aal1. Under `require_mfa` it is
            // false until re-read at aal2, and the console gate turns on it.
            void refresh();
          }}
          onSignOut={signOut}
        />
      );

    case 'unsupported':
      return (
        <GateNotice
          title="This sign-in needs a second factor RotaFlow cannot ask for"
          body="Your account has a second factor that is not an authenticator app. Sign out, then ask RotaFlow support to reset two-factor authentication on your account."
          onSignOut={signOut}
        />
      );

    case 'error':
      return (
        <GateNotice
          title="Could not check your sign-in"
          body="We could not confirm whether this sign-in needs a code from your authenticator app, so nothing has been opened. Try again, or sign out."
          onRetry={recheck}
          onSignOut={signOut}
        />
      );
  }
}

function GateNotice({
  title,
  body,
  onRetry,
  onSignOut,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
  onSignOut: () => Promise<void>;
}): JSX.Element {
  return (
    <div className="grid min-h-screen place-items-center bg-surface-subtle p-6 dark:bg-surface-subtle-dark">
      <Card className="max-w-md text-center">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-danger/10 text-danger">
          <ShieldAlert size={22} aria-hidden="true" />
        </span>
        <h1 className="mb-2 font-display text-xl font-semibold text-content dark:text-content-dark">
          {title}
        </h1>
        <p className="mb-5 text-sm text-content-muted dark:text-content-muted-dark">
          {body}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {onRetry && (
            <Button onClick={onRetry}>
              <RotateCw size={18} aria-hidden="true" />
              Try again
            </Button>
          )}
          <Button variant="secondary" onClick={() => void onSignOut()}>
            <LogOut size={18} aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}
