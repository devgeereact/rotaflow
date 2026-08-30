import { useCallback, useEffect, useState } from 'react';
import { Link2, Link2Off, Mail, ShieldCheck } from 'lucide-react';
import type { UserIdentity } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { reportError } from '@/lib/sentry';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SettingsSection } from '@/components/settings/SettingsSection';
import type { OAuthProvider } from '@/lib/env';

const PROVIDER_LABEL: Record<string, string> = {
  email: 'Email and password',
  google: 'Google',
  azure: 'Microsoft',
  github: 'GitHub',
  apple: 'Apple',
};

function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

function formatWhen(iso: string | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * `/app/account/accounts`. NEW_STRUCTURE §21's "Connected Accounts" tab.
 *
 * ## What is real here
 *
 * Everything on this page comes from `auth.getUserIdentities()`, which is the
 * account's actual identity list. The sign-in methods that genuinely work.
 * Linking uses `linkIdentity` and unlinking `unlinkIdentity`, both of which
 * change the account server-side. Nothing is mocked.
 *
 * ## Why the list of offerable providers is short
 *
 * §21 names Google, Microsoft and Apple. What can actually be offered is
 * whatever `VITE_OAUTH_PROVIDERS` declares. The same list the sign-in screen
 * reads, and for the same reason (`lib/env.ts`): rendering a button for a
 * provider that is disabled in the Supabase dashboard is a dead end for the
 * user. `OAuthProvider` is `google | github` today, so Microsoft and Apple are
 * not offered rather than being shown as buttons that cannot work. Adding one
 * means widening that union, enabling it in the dashboard and listing it in
 * the env var, no change here.
 *
 * An identity for a provider that is *already linked* still renders, even if
 * it is no longer offerable, so nothing a user has connected can silently
 * vanish from the list.
 *
 * ## Why the last identity cannot be unlinked
 *
 * Supabase refuses it server-side, and rightly: removing the only sign-in
 * method locks the account out permanently. The button is disabled with the
 * reason shown rather than left clickable to fail, but the server check is
 * the real guard, not this.
 */
export function ConnectedAccountsPage(): JSX.Element {
  const { showError, showSuccess } = useToast();
  const { confirm } = useConfirm();

  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoadFailed(false);
      const { data, error } = await supabase.auth.getUserIdentities();
      if (!active) return;
      if (error) {
        reportError(error, { area: 'account:identities' });
        setLoadFailed(true);
        return;
      }
      setIdentities(data?.identities ?? []);
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const handleLink = useCallback(
    async (provider: OAuthProvider): Promise<void> => {
      setWorking(provider);
      try {
        const { error } = await supabase.auth.linkIdentity({ provider });
        // Success navigates away to the provider, so there is nothing to
        // report here, only the failure path returns to this line.
        if (error) throw error;
      } catch (err) {
        reportError(err, { area: 'account:link-identity' });
        showError(`Could not start linking ${providerLabel(provider)}. Try again.`);
        setWorking(null);
      }
    },
    [showError],
  );

  const handleUnlink = useCallback(
    async (identity: UserIdentity): Promise<void> => {
      const label = providerLabel(identity.provider);
      const ok = await confirm({
        title: `Disconnect ${label}?`,
        message: `You will no longer be able to sign in with ${label}. Your other sign-in methods keep working, and you can reconnect it at any time.`,
        confirmLabel: 'Disconnect',
        tone: 'danger',
      });
      if (!ok) return;

      setWorking(identity.identity_id);
      try {
        const { error } = await supabase.auth.unlinkIdentity(identity);
        if (error) throw error;
        showSuccess(`${label} disconnected.`);
        setReloadKey((k) => k + 1);
      } catch (err) {
        reportError(err, { area: 'account:unlink-identity' });
        showError(`Could not disconnect ${label}. Please try again.`);
      } finally {
        setWorking(null);
      }
    },
    [confirm, showError, showSuccess],
  );

  const linkedProviders = new Set((identities ?? []).map((i) => i.provider));
  const availableToLink = env.oauthProviders.filter((p) => !linkedProviders.has(p));
  // Supabase refuses to remove the last identity; say why rather than let it fail.
  const isOnlyIdentity = (identities?.length ?? 0) <= 1;

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Connected accounts"
        description="The ways you can sign in to RotaFlow. Connecting an account does not give it access to your organisation's data."
      >
        {loadFailed ? (
          <div>
            <p className="mb-3 text-sm text-content-muted dark:text-content-muted-dark">
              Could not load your sign-in methods.
            </p>
            <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </Button>
          </div>
        ) : identities === null ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Loading…
          </p>
        ) : (
          <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
            {identities.map((identity) => {
              const label = providerLabel(identity.provider);
              const email =
                typeof identity.identity_data?.email === 'string'
                  ? identity.identity_data.email
                  : null;
              const since = formatWhen(identity.created_at);
              const busy = working === identity.identity_id;

              return (
                <li
                  key={identity.identity_id}
                  className="flex flex-wrap items-center gap-3 px-5 py-4"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary dark:text-primary-ink-dark">
                    {identity.provider === 'email' ? (
                      <Mail size={16} aria-hidden="true" />
                    ) : (
                      <ShieldCheck size={16} aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-content dark:text-content-dark">
                      {label}
                      <Badge tone="success">Connected</Badge>
                    </p>
                    <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                      {email ?? 'No address recorded'}
                      {since ? ` · connected ${since}` : ''}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={busy || isOnlyIdentity}
                    title={
                      isOnlyIdentity
                        ? 'This is your only way to sign in. Connect another method first'
                        : undefined
                    }
                    onClick={() => void handleUnlink(identity)}
                  >
                    <Link2Off size={14} aria-hidden="true" />
                    {busy ? 'Disconnecting…' : 'Disconnect'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection
        title="Add a sign-in method"
        description="Connect another provider so you can sign in with it as well."
      >
        {availableToLink.length === 0 ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            {identities === null
              ? 'Loading…'
              : env.oauthProviders.length === 0
                ? 'No single sign-on providers are enabled for this deployment. These are configured in Supabase, under Authentication → Providers.'
                : 'Everything available is already connected.'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {availableToLink.map((provider) => (
              <Button
                key={provider}
                variant="secondary"
                disabled={working === provider}
                onClick={() => void handleLink(provider)}
              >
                <Link2 size={14} aria-hidden="true" />
                {working === provider
                  ? 'Redirecting…'
                  : `Connect ${providerLabel(provider)}`}
              </Button>
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
