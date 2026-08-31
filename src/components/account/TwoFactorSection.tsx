import { useCallback, useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/hooks/useToast';
import { reportError } from '@/lib/sentry';
import {
  confirmMfaEnrolment,
  listMfaFactors,
  removeMfaFactor,
  startMfaEnrolment,
  type MfaEnrolment,
  type MfaFactor,
} from '@/services/mfaService';

/**
 * Two-factor authentication, on `/app/account/security` (CAP-049).
 *
 * This screen used to carry a card reading "Two-factor authentication is not
 * available yet". That was honest, and it is now false.
 *
 * ## The setup flow is three steps and says so
 *
 * Scan, type a code, done. The secret is shown as text beside the QR code
 * rather than behind a "can't scan?" link, because the most common case is
 * somebody setting this up on the phone that is displaying the page, and that
 * phone cannot scan its own screen.
 *
 * ## Removing a factor needs the factor
 *
 * Supabase requires an `aal2` session to unenroll, and that rule is enforced
 * server-side rather than by this component. Somebody holding a stolen
 * password cannot strip the second factor off the account. If the error
 * arrives, the message says what it means rather than repeating the API's.
 */
export function TwoFactorSection(): JSX.Element {
  const { showError, showSuccess } = useToast();
  const { confirm } = useConfirm();

  const [factors, setFactors] = useState<MfaFactor[] | null>(null);
  const [enrolment, setEnrolment] = useState<MfaEnrolment | null>(null);
  const [code, setCode] = useState('');
  const [working, setWorking] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const found = await listMfaFactors();
        if (active) setFactors(found);
      } catch (err) {
        reportError(err, { area: 'account-security:list-factors' });
        if (active) setFactors([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const verified = (factors ?? []).filter((f) => f.status === 'verified');

  const handleStart = useCallback(async (): Promise<void> => {
    setWorking(true);
    try {
      // A name, so a list of two factors is readable later. The date is in it
      // because "iPhone" tells nobody which enrolment they are looking at.
      const started = await startMfaEnrolment(
        `Authenticator app · ${new Date().toLocaleDateString('en-GB')}`,
      );
      setEnrolment(started);
      setCode('');
    } catch (err) {
      reportError(err, { area: 'account-security:enrol' });
      showError('Could not start setting up two-factor authentication.');
    } finally {
      setWorking(false);
    }
  }, [showError]);

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (!enrolment) return;
    setWorking(true);
    try {
      await confirmMfaEnrolment(enrolment.factorId, code);
      setEnrolment(null);
      setCode('');
      setReloadKey((k) => k + 1);
      showSuccess('Two-factor authentication is on for this account.');
    } catch (err) {
      reportError(err, { area: 'account-security:verify' });
      // Almost always a wrong or expired code, and saying so is more useful
      // than the API's wording. A code is valid for thirty seconds; a phone
      // whose clock has drifted produces this every time.
      showError(
        'That code was not accepted. Codes last about 30 seconds — try the current one.',
      );
    } finally {
      setWorking(false);
    }
  }, [enrolment, code, showError, showSuccess]);

  const handleRemove = useCallback(
    async (factor: MfaFactor): Promise<void> => {
      const ok = await confirm({
        title: 'Remove two-factor authentication?',
        message:
          'Your account will be protected by your password alone. If your organisation requires a second factor you will not be able to sign in to the console.',
        confirmLabel: 'Remove',
        tone: 'danger',
      });
      if (!ok) return;

      setWorking(true);
      try {
        await removeMfaFactor(factor.id);
        setReloadKey((k) => k + 1);
        showSuccess('Two-factor authentication removed.');
      } catch (err) {
        reportError(err, { area: 'account-security:unenrol' });
        showError(
          'Removing a factor needs a session that has used it. Sign out, sign in with your code, then try again.',
        );
      } finally {
        setWorking(false);
      }
    },
    [confirm, showError, showSuccess],
  );

  return (
    <SettingsSection
      title="Two-factor authentication"
      description="A code from an authenticator app, in addition to your password."
    >
      {verified.length > 0 ? (
        <ul className="mb-5 divide-y divide-divider dark:divide-divider-dark">
          {verified.map((factor) => (
            <li key={factor.id} className="flex items-center gap-3 py-3">
              <ShieldCheck
                size={18}
                className="shrink-0 text-success-ink"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-content dark:text-content-dark">
                  {factor.friendlyName ?? 'Authenticator app'}
                </p>
                <p className="text-xs text-content-muted dark:text-content-muted-dark">
                  Added {new Date(factor.createdAt).toLocaleDateString('en-GB')}
                </p>
              </div>
              <Badge tone="success">On</Badge>
              <Button
                variant="ghost"
                disabled={working}
                aria-label={`Remove ${factor.friendlyName ?? 'authenticator app'}`}
                onClick={() => void handleRemove(factor)}
              >
                <Trash2 size={16} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : enrolment ? (
        <div className="mb-5 space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-content-muted dark:text-content-muted-dark">
            <li>Open your authenticator app.</li>
            <li>Scan this code, or type the key below it.</li>
            <li>Enter the six digits it shows.</li>
          </ol>

          <div className="flex flex-wrap items-start gap-5">
            <img
              src={enrolment.qrCode}
              alt="QR code for setting up two-factor authentication"
              className="h-40 w-40 rounded-xl bg-white p-2"
            />
            <div className="min-w-0">
              <Label htmlFor="mfa-secret">Or type this key</Label>
              <p
                id="mfa-secret"
                className="mt-1 max-w-xs break-all font-mono text-sm text-content dark:text-content-dark"
              >
                {enrolment.secret}
              </p>
              <p className="mt-2 max-w-xs text-xs text-content-muted dark:text-content-muted-dark">
                Setting this up on the phone showing this page? It cannot scan its own
                screen — type the key instead.
              </p>
            </div>
          </div>

          <div className="max-w-[220px]">
            <Label htmlFor="mfa-code">Six-digit code</Label>
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              icon={KeyRound}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </div>

          <div className="flex gap-3">
            <Button
              disabled={working || code.length !== 6}
              onClick={() => void handleConfirm()}
            >
              {working ? 'Checking…' : 'Turn on'}
            </Button>
            <Button
              variant="secondary"
              disabled={working}
              onClick={() => setEnrolment(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="mb-5 text-sm text-content-muted dark:text-content-muted-dark">
          {factors === null
            ? 'Checking…'
            : 'Your account is protected by your password alone. An authenticator app adds a code that changes every 30 seconds.'}
        </p>
      )}

      {verified.length === 0 && !enrolment && (
        <Button disabled={working || factors === null} onClick={() => void handleStart()}>
          <ShieldCheck size={16} aria-hidden="true" />
          Set up two-factor authentication
        </Button>
      )}
    </SettingsSection>
  );
}
