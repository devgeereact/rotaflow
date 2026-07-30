import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { CheckCircle2, Eye, EyeOff, Lock, Mail, Plug } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/useToast';
import {
  deleteOrgSmtpSettings,
  getOrgSmtpSettings,
  saveOrgSmtpSettings,
  testOrgSmtpSettings,
  updateOrgSmtpFields,
} from '@/services/smtpSettingsService';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import type { OrgSmtpSettingsSafe } from '@/types';

/**
 * `/app/integrations` — owner-only. Lets an org connect its own SMTP account
 * so notification emails go out from their domain/mailbox instead of
 * RotaFlow's shared sender. The password is never re-displayed once saved
 * (org_smtp_settings has no select policy on that column at all — see
 * 0010_org_smtp_settings.sql) — editing host/username/from-address leaves it
 * untouched, and changing it requires typing a new one.
 */
export function IntegrationsPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canManageOrg } = usePermissions();
  const { showError, showSuccess } = useToast();

  const [existing, setExisting] = useState<OrgSmtpSettingsSafe | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const row = await getOrgSmtpSettings(orgId);
        if (!active) return;
        setExisting(row);
        if (row) {
          setSmtpHost(row.smtp_host);
          setSmtpPort(String(row.smtp_port));
          setSmtpUser(row.smtp_user);
          setFromEmail(row.from_email);
          setFromName(row.from_name ?? '');
        }
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'integrations:load' });
        setLoadFailed(true);
        showError('Could not load SMTP settings.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, reloadKey, showError]);

  const canSubmit =
    smtpHost.trim() &&
    smtpUser.trim() &&
    fromEmail.trim() &&
    (existing ? true : smtpPass.trim());

  const handleSave = useCallback(async (): Promise<void> => {
    if (!orgId || !canSubmit) return;
    setSaving(true);
    setTestResult(null);
    try {
      const port = Number(smtpPort) || 587;
      if (smtpPass.trim()) {
        await saveOrgSmtpSettings({
          org_id: orgId,
          smtp_host: smtpHost.trim(),
          smtp_port: port,
          smtp_user: smtpUser.trim(),
          smtp_pass: smtpPass.trim(),
          from_email: fromEmail.trim(),
          from_name: fromName.trim() || null,
          // A credential change invalidates any prior "verified" claim —
          // only test-smtp gets to set this again.
          verified_at: null,
        });
      } else {
        await updateOrgSmtpFields(orgId, {
          smtp_host: smtpHost.trim(),
          smtp_port: port,
          smtp_user: smtpUser.trim(),
          from_email: fromEmail.trim(),
          from_name: fromName.trim() || null,
        });
      }
      const row = await getOrgSmtpSettings(orgId);
      setExisting(row);
      setSmtpPass('');
      showSuccess('SMTP settings saved. Send a test email to confirm they work.');
    } catch (err) {
      reportError(err, { area: 'integrations:save' });
      showError('Could not save SMTP settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [
    orgId,
    canSubmit,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    fromEmail,
    fromName,
    showError,
    showSuccess,
  ]);

  const handleTest = useCallback(async (): Promise<void> => {
    if (!orgId || !existing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testOrgSmtpSettings(orgId);
      if (result.ok) {
        setTestResult({
          ok: true,
          message: `Test email sent to ${result.sentTo ?? 'your address'}.`,
        });
        const row = await getOrgSmtpSettings(orgId);
        setExisting(row);
      } else {
        setTestResult({
          ok: false,
          message: result.error ?? 'The test email could not be sent.',
        });
      }
    } catch (err) {
      reportError(err, { area: 'integrations:test' });
      showError('Could not run the SMTP test. Please try again.');
    } finally {
      setTesting(false);
    }
  }, [orgId, existing, showError]);

  const handleRemove = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    try {
      await deleteOrgSmtpSettings(orgId);
      setExisting(null);
      setSmtpHost('');
      setSmtpPort('587');
      setSmtpUser('');
      setSmtpPass('');
      setFromEmail('');
      setFromName('');
      setTestResult(null);
      showSuccess('SMTP settings removed. Notifications will use the shared sender.');
    } catch (err) {
      reportError(err, { area: 'integrations:delete' });
      showError('Could not remove SMTP settings.');
    }
  }, [orgId, showError, showSuccess]);

  if (!canManageOrg) {
    return (
      <Card>
        <p className="text-content-muted dark:text-content-muted-dark">
          Only the organisation owner can manage integrations.
        </p>
      </Card>
    );
  }

  if (loadFailed && !loading) {
    return (
      <Card>
        <p className="mb-4 text-content-muted dark:text-content-muted-dark">
          Could not load SMTP settings.
        </p>
        <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 flex items-center gap-2 font-display text-2xl text-content dark:text-content-dark">
        <Plug size={22} aria-hidden="true" />
        Integrations
      </h1>
      <p className="mb-6 text-sm text-content-muted dark:text-content-muted-dark">
        Connect your own SMTP account so shift, leave and swap notifications arrive from
        your organisation's own address instead of a shared sender.
      </p>

      <Card>
        <h2 className="mb-1 font-medium text-content dark:text-content-dark">
          Email (SMTP)
        </h2>
        {existing?.verified_at ? (
          <p className="mb-4 flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 size={16} aria-hidden="true" />
            Verified {new Date(existing.verified_at).toLocaleString()}
          </p>
        ) : existing ? (
          <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
            Saved but not yet tested — send a test email to confirm it works.
          </p>
        ) : (
          <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
            Not configured — notifications currently use RotaFlow's shared sender.
          </p>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Label htmlFor="smtp-host">Host</Label>
              <Input
                id="smtp-host"
                value={smtpHost}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setSmtpHost(e.target.value)
                }
                placeholder="smtp.yourhost.com"
              />
            </div>
            <div>
              <Label htmlFor="smtp-port">Port</Label>
              <Input
                id="smtp-port"
                type="number"
                inputMode="numeric"
                value={smtpPort}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setSmtpPort(e.target.value)
                }
              />
            </div>
          </div>

          <div>
            <Label htmlFor="smtp-user">Username</Label>
            <Input
              id="smtp-user"
              value={smtpUser}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSmtpUser(e.target.value)}
              placeholder="notifications@yourorg.com"
            />
          </div>

          <div>
            <Label htmlFor="smtp-pass">
              Password{' '}
              {existing && (
                <span className="text-content-muted dark:text-content-muted-dark">
                  (leave blank to keep the saved one)
                </span>
              )}
            </Label>
            <Input
              id="smtp-pass"
              type={showPassword ? 'text' : 'password'}
              icon={Lock}
              autoComplete="new-password"
              value={smtpPass}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSmtpPass(e.target.value)}
              placeholder={existing ? '••••••••' : 'SMTP password'}
              endAdornment={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="grid h-7 w-7 place-items-center rounded-md text-content-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark dark:hover:text-content-dark"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="smtp-from-email">From address</Label>
              <Input
                id="smtp-from-email"
                type="email"
                icon={Mail}
                value={fromEmail}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setFromEmail(e.target.value)
                }
                placeholder="notifications@yourorg.com"
              />
            </div>
            <div>
              <Label htmlFor="smtp-from-name">From name (optional)</Label>
              <Input
                id="smtp-from-name"
                value={fromName}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setFromName(e.target.value)
                }
                placeholder="Your Organisation"
              />
            </div>
          </div>

          {testResult && (
            <p
              className={testResult.ok ? 'text-sm text-success' : 'text-sm text-danger'}
              role="status"
            >
              {testResult.message}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button onClick={() => void handleSave()} disabled={saving || !canSubmit}>
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
            {existing && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => void handleTest()}
                  disabled={testing}
                >
                  {testing ? 'Sending test…' : 'Send test email'}
                </Button>
                <Button
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  onClick={() => void handleRemove()}
                  disabled={saving || testing}
                >
                  Remove
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
