import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { AUTH_FEATURES } from '@/lib/marketing';
import { reportError } from '@/lib/sentry';
import {
  MFA_FAILURE_MESSAGES,
  classifyMfaError,
  isCompleteCode,
  normaliseCode,
  type ChallengeFactor,
} from '@/lib/mfaStep';
import { verifySignInCode } from '@/services/mfaService';

interface MfaChallengeProps {
  /** Verified TOTP factors, never empty. More than one shows a choice. */
  factors: ChallengeFactor[];
  defaultFactorId: string;
  /** Called once the session has been upgraded to `aal2`. */
  onVerified: () => void;
  onSignOut: () => Promise<void>;
}

/**
 * The second sign-in step (CAP-049): "Enter the 6-digit code from your
 * authenticator app".
 *
 * Shown by `MfaGate` in place of anything protected, so it covers every way a
 * first factor can arrive: password, magic link, OAuth callback, and a session
 * restored from storage that never finished this step.
 *
 * A wrong code keeps the person here, clears the field, puts focus back in it
 * and says why, because the next attempt is the only useful thing to do.
 * Signing out is always available: somebody without their phone must not be
 * stuck on a screen with one input and no exit.
 */
export function MfaChallenge({
  factors,
  defaultFactorId,
  onVerified,
  onSignOut,
}: MfaChallengeProps): JSX.Element {
  const [factorId, setFactorId] = useState(defaultFactorId);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const choiceName = useId();

  // Focus on arrival: the code is the only thing this screen asks for. An
  // effect rather than `autoFocus`, which jsx-a11y rightly discourages on
  // ordinary pages; here the field is the page.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (): Promise<void> => {
    if (busy || !isCompleteCode(code)) return;
    setBusy(true);
    setError(null);
    try {
      await verifySignInCode(factorId, code);
      onVerified();
    } catch (err) {
      const kind = classifyMfaError(err);
      // A wrong code is the person, not the system. Everything else is worth
      // knowing about.
      if (kind !== 'wrong-code') reportError(err, { area: 'mfa:sign-in-verify' });
      setError(MFA_FAILURE_MESSAGES[kind]);
      setCode('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const signOut = async (): Promise<void> => {
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <AuthSplitLayout
      headline="Scheduling certainty"
      headlineAccent="for every shift."
      description="Build rotas with fewer surprises, keep staff informed, and keep a dependable attendance record, even when the signal drops."
      features={AUTH_FEATURES}
    >
      <div className="w-full max-w-2xl rounded-2xl border border-surface-border bg-surface p-9 shadow dark:border-surface-border-dark dark:bg-surface-dark md:p-11">
        <h1 className="mb-1 font-display text-3xl font-bold text-ink dark:text-content-dark">
          Two-factor authentication
        </h1>
        <p className="mb-6 text-ink-muted dark:text-content-muted-dark">
          Enter the 6-digit code from your authenticator app.
        </p>

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {factors.length > 1 && (
            <fieldset className="mb-6">
              <legend className="mb-2 text-sm font-medium text-content dark:text-content-dark">
                Which authenticator app?
              </legend>
              <div className="space-y-2">
                {factors.map((f) => (
                  <label
                    key={f.id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-surface-border px-3 text-sm text-content dark:border-surface-border-dark dark:text-content-dark"
                  >
                    <input
                      type="radio"
                      name={choiceName}
                      value={f.id}
                      checked={factorId === f.id}
                      onChange={() => {
                        setFactorId(f.id);
                        setError(null);
                      }}
                      className="h-5 w-5"
                    />
                    <span>
                      {f.friendlyName ?? 'Authenticator app'}
                      <span className="block text-xs text-content-muted dark:text-content-muted-dark">
                        Added {new Date(f.createdAt).toLocaleDateString('en-GB')}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <Field
            label="6-digit code"
            hint="The code changes every 30 seconds."
            error={error}
            className="mb-6"
          >
            <Input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              icon={KeyRound}
              className="h-12 font-mono text-lg tracking-widest"
              value={code}
              // No `maxLength`: a pasted "123 456" is seven characters, and the
              // browser would cut it to "123 45" before `normaliseCode` saw it.
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setCode(normaliseCode(e.target.value));
              }}
            />
          </Field>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={busy || signingOut || !isCompleteCode(code)}
          >
            {busy ? 'Checking…' : 'Verify'}
          </Button>
        </form>

        {/* Announced separately from the field's description: the field is
            refocused after a failure, but a screen reader that was on the
            button needs to hear why it moved. */}
        <p role="alert" className="sr-only">
          {error ?? ''}
        </p>

        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="mt-3 w-full"
          disabled={busy || signingOut}
          onClick={() => void signOut()}
        >
          <LogOut size={18} aria-hidden="true" />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </Button>

        <p className="mt-6 text-center text-sm text-ink-muted dark:text-content-muted-dark">
          Lost access to your authenticator app? Sign out and contact RotaFlow support,
          who can remove the old factor so you can set up a new one.
        </p>
      </div>
    </AuthSplitLayout>
  );
}
