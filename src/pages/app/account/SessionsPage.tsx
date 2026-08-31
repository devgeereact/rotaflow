import { useCallback, useEffect, useState } from 'react';
import { Laptop, LogOut, MonitorSmartphone } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { reportError } from '@/lib/sentry';
import {
  listMySessions,
  revokeMyOtherSessions,
  type AccountSession,
} from '@/services/profileService';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SettingsSection } from '@/components/settings/SettingsSection';

/**
 * `/app/account/sessions`. Design/ProfileSettings.png, "Connected sessions".
 *
 * ## What changed, and what this comment used to say
 *
 * It used to explain that only one session could be listed, because "there is
 * no `auth.sessions` read exposed to an anon key, and no table in this schema
 * recording device, user agent, IP or last-seen". The second half was wrong:
 * `auth.sessions` is GoTrue's own table and has carried all of that the whole
 * time. Nothing surfaced it (CAP-050).
 *
 * `my_sessions()` (`0100`) does. It is SECURITY DEFINER, filters on
 * `auth.uid()`, and takes no argument — there is no session id to pass, so
 * there is no way to ask about anybody else's.
 *
 * ## Why "sign out the others" and not one at a time
 *
 * The reference shows a Sign out button per row. Matching a row to a physical
 * device means reading a user agent, and somebody who cannot tell which
 * "Mobile Safari on iOS" is the lost phone will either pick wrong or not act.
 * The safe action they actually want is "everything except what I am holding",
 * so that is the button. "Sign out everywhere" stays for the case where this
 * device is the compromised one.
 *
 * ## It is not instant, and the screen says so
 *
 * Revoking removes the session rows, so the refresh stops working. An access
 * token already issued stays valid until it expires — an hour on this project.
 * "Signed out within the hour" is the true claim.
 */
export function SessionsPage(): JSX.Element {
  const { showError, showSuccess } = useToast();
  const { confirm } = useConfirm();

  const [signedInAt, setSignedInAt] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [sessions, setSessions] = useState<AccountSession[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const found = await listMySessions();
        if (active) setSessions(found);
      } catch (err) {
        // Non-fatal, and the empty state says so. The controls below work
        // whether or not the list can be read, and the one that matters —
        // revoking — must not be gated on a display query.
        reportError(err, { area: 'account-sessions:list' });
        if (active) setSessions(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const handleSignOutOthers = useCallback(async (): Promise<void> => {
    const ok = await confirm({
      title: 'Sign out other devices?',
      message:
        'Every other device signed in to this account will be signed out. This one stays signed in.',
      confirmLabel: 'Sign out others',
      tone: 'danger',
    });
    if (!ok) return;

    setWorking(true);
    try {
      const ended = await revokeMyOtherSessions();
      setReloadKey((k) => k + 1);
      showSuccess(
        ended === 0
          ? 'No other devices were signed in.'
          : `${ended} other ${ended === 1 ? 'device' : 'devices'} will be signed out within the hour.`,
      );
    } catch (err) {
      reportError(err, { area: 'account-sessions:sign-out-others' });
      showError('Could not sign out the other devices. Please try again.');
    } finally {
      setWorking(false);
    }
  }, [confirm, showError, showSuccess]);

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
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary dark:text-primary-ink-dark">
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
        title="Where you are signed in"
        description="Every session on this account. Signing out the others leaves this device alone."
      >
        {sessions === null ? (
          <p className="mb-5 text-sm text-content-muted dark:text-content-muted-dark">
            Your other sessions could not be listed just now. The buttons below still work
            — revoking does not depend on this list.
          </p>
        ) : (
          <ul className="mb-5 divide-y divide-divider dark:divide-divider-dark">
            {sessions.map((session) => (
              <li key={session.sessionId} className="flex items-start gap-4 py-3">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary-ink dark:text-primary-ink-dark">
                  <MonitorSmartphone size={17} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-content dark:text-content-dark">
                    {session.userAgent ?? 'Unknown device'}
                  </p>
                  <p className="mt-0.5 text-xs text-content-muted dark:text-content-muted-dark">
                    {session.ip ? `${session.ip} · ` : ''}
                    last used{' '}
                    {new Date(session.refreshedAt ?? session.createdAt).toLocaleString(
                      'en-GB',
                    )}
                  </p>
                </div>
                {session.isCurrent && <Badge tone="success">This device</Badge>}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            disabled={working}
            onClick={() => void handleSignOutOthers()}
          >
            <LogOut size={16} aria-hidden="true" />
            {working ? 'Working…' : 'Sign out other devices'}
          </Button>
          <Button
            variant="danger-outline"
            disabled={working}
            onClick={() => void handleSignOutEverywhere()}
          >
            <LogOut size={16} aria-hidden="true" />
            Sign out everywhere
          </Button>
        </div>
        <p className="mt-3 text-sm text-content-muted dark:text-content-muted-dark">
          A signed-out device stops working within the hour rather than immediately: the
          access token it already holds stays valid until it expires.
        </p>
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
