import { useCallback, useEffect, useState } from 'react';
import { Laptop, LogOut } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { reportError } from '@/lib/sentry';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SettingsSection } from '@/components/settings/SettingsSection';

/**
 * `/app/account/sessions` — design/ProfileSettings.png, "Connected sessions".
 *
 * ## Why only one session is listed
 *
 * The reference lists three devices — Chrome on macOS, Safari on iPhone,
 * Chrome on Windows — each with a location and a "Sign out" button. That needs
 * a server-side session registry: Supabase's client SDK can only see the
 * session held by *this* browser. There is no `auth.sessions` read exposed to
 * an anon key, and no table in this schema recording device, user agent, IP or
 * last-seen.
 *
 * Building the card anyway would mean inventing the other two rows. So this
 * shows the one session that genuinely exists here, says plainly that other
 * devices are not listed, and offers the control that *does* work everywhere:
 * "sign out everywhere", which revokes every refresh token for the account
 * server-side — including the devices this page cannot enumerate.
 *
 * That is the useful half of the feature. Someone who has lost a phone needs
 * to revoke it, and `scope: 'global'` does exactly that without needing to see
 * it in a list first.
 */
export function SessionsPage(): JSX.Element {
  const { showError, showSuccess } = useToast();
  const { confirm } = useConfirm();

  const [signedInAt, setSignedInAt] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      const session = data.session;
      setSignedInAt(session?.user.last_sign_in_at ?? null);
      setExpiresAt(
        session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
      );
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleSignOutEverywhere = useCallback(async (): Promise<void> => {
    const ok = await confirm({
      title: 'Sign out everywhere?',
      message:
        'Every device signed in to this account will be signed out, including this one. You will need to sign in again.',
      confirmLabel: 'Sign out everywhere',
      tone: 'danger',
    });
    if (!ok) return;

    setWorking(true);
    try {
      // 'global' revokes every refresh token for the user server-side, so the
      // devices this page cannot list are covered too.
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) throw error;
      showSuccess('Signed out on all devices.');
    } catch (err) {
      reportError(err, { area: 'account-sessions:sign-out-all' });
      showError('Could not sign out everywhere. Please try again.');
    } finally {
      setWorking(false);
    }
  }, [confirm, showError, showSuccess]);

  return (
    <div className="max-w-3xl space-y-6">
      <SettingsSection
        title="This device"
        description="The session you are using right now."
      >
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Laptop size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-content dark:text-content-dark">
              Current browser
            </p>
            <p className="mt-0.5 text-xs text-content-muted dark:text-content-muted-dark">
              {signedInAt
                ? `Signed in ${new Date(signedInAt).toLocaleString('en-GB')}`
                : 'Session active'}
              {expiresAt &&
                ` · renews ${new Date(expiresAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
            </p>
          </div>
          <Badge tone="success">Active</Badge>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Other devices"
        description="Sign out everywhere if you have lost a device or think someone else has access."
      >
        <p className="mb-5 text-sm text-content-muted dark:text-content-muted-dark">
          RotaFlow cannot list your other signed-in devices — sessions are held by each
          browser, and nothing records them centrally. Signing out everywhere still
          revokes them all, including devices that are not shown here.
        </p>
        <Button
          variant="danger-outline"
          disabled={working}
          onClick={() => void handleSignOutEverywhere()}
        >
          <LogOut size={16} aria-hidden="true" />
          {working ? 'Signing out…' : 'Sign out everywhere'}
        </Button>
      </SettingsSection>

      <Card className="bg-info/5">
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Signing out everywhere ends this session too, so you will be returned to the
          sign-in page.
        </p>
      </Card>
    </div>
  );
}
