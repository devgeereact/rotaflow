import { CheckCircle2, MinusCircle } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { AdminPage } from '@/components/admin/AdminPage';
import { env } from '@/lib/env';

interface Capability {
  name: string;
  enabled: boolean;
  detail: string;
}

/**
 * `/admin/feature-flags` — NEW_STRUCTURE §34's feature flags.
 *
 * ## Why nothing here can be toggled
 *
 * A feature flag needs somewhere to live. There is no `feature_flags` table in
 * any migration, and no flag service — so a screen with switches on it would be
 * switches that persist nowhere, which is worse than no screen at all.
 *
 * What genuinely determines what this deployment can do is its build-time
 * configuration: which integrations have keys, which OAuth providers are
 * declared. Those are real, they are read from `lib/env.ts` — the same source
 * the rest of the app branches on — and knowing them is the actual question a
 * platform administrator brings to this page ("is push configured on prod?").
 *
 * So this reports capability, read-only and accurately, and says plainly that
 * per-tenant flags need a store that does not exist yet.
 */
export function AdminFeatureFlagsPage(): JSX.Element {
  const capabilities: Capability[] = [
    {
      name: 'Single sign-on',
      enabled: env.oauthProviders.length > 0,
      detail:
        env.oauthProviders.length > 0
          ? `Providers offered: ${env.oauthProviders.join(', ')}`
          : 'No OAuth providers declared in VITE_OAUTH_PROVIDERS',
    },
    {
      name: 'Web push notifications',
      enabled: Boolean(env.vapidPublicKey),
      detail: env.vapidPublicKey
        ? 'VAPID public key present'
        : 'No VAPID key — push subscriptions cannot be created',
    },
    {
      name: 'Error monitoring',
      enabled: Boolean(env.sentryDsn),
      detail: env.sentryDsn
        ? 'Sentry DSN configured'
        : 'No Sentry DSN — errors are not reported',
    },
    {
      name: 'Media hosting',
      enabled: Boolean(env.imagekitUrlEndpoint),
      detail: env.imagekitUrlEndpoint
        ? 'ImageKit endpoint configured'
        : 'No ImageKit endpoint — uploads fall back to local handling',
    },
    {
      name: 'Background workflows',
      enabled: Boolean(env.inngestEventKey),
      detail: env.inngestEventKey
        ? 'Inngest event key present'
        : 'No Inngest key — scheduled and queued jobs are not dispatched',
    },
  ];

  return (
    <AdminPage
      title="Feature flags"
      description="What this deployment is configured to do."
    >
      <div className="space-y-6">
        <Card className="border-warning/30 bg-warning/5">
          <h2 className="mb-1 font-semibold text-content dark:text-content-dark">
            Per-tenant feature flags are not built
          </h2>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Turning a feature on for one organisation and not another needs a
            <code className="mx-1 rounded bg-surface-subtle px-1 py-0.5 text-xs dark:bg-surface-subtle-dark">
              feature_flags
            </code>
            table and a service to read it. Neither exists in any migration, so there is
            nothing here to switch — a toggle that persisted nowhere would be worse than
            none.
          </p>
          <p className="mt-2 text-sm text-content-muted dark:text-content-muted-dark">
            What is below is real: the build-time configuration this deployment is
            actually running with, read from the same place the rest of the app branches
            on.
          </p>
        </Card>

        <Card className="p-0">
          <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
            {capabilities.map((capability) => (
              <li
                key={capability.name}
                className="flex flex-wrap items-center gap-3 px-5 py-4"
              >
                <span
                  className={
                    capability.enabled
                      ? 'text-success'
                      : 'text-content-muted dark:text-content-muted-dark'
                  }
                >
                  {capability.enabled ? (
                    <CheckCircle2 size={18} aria-hidden="true" />
                  ) : (
                    <MinusCircle size={18} aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-content dark:text-content-dark">
                    {capability.name}
                  </p>
                  <p className="text-xs text-content-muted dark:text-content-muted-dark">
                    {capability.detail}
                  </p>
                </div>
                {/* Colour is not the only signal — the word says it too (§26). */}
                <Badge tone={capability.enabled ? 'success' : 'neutral'}>
                  {capability.enabled ? 'Configured' : 'Not configured'}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>

        <p className="text-xs text-content-muted dark:text-content-muted-dark">
          Environment: {env.mode}
          {env.isProd ? ' (production build)' : ''}.
        </p>
      </div>
    </AdminPage>
  );
}
