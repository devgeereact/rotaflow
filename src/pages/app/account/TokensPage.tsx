import { KeyRound } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SettingsSection } from '@/components/settings/SettingsSection';

/**
 * `/app/account/tokens`. Design/ProfileSettings.png, "API Tokens".
 *
 * ## Why this ships as an explanation rather than a token manager
 *
 * There is no public API to hold a token for. RotaFlow's data access is
 * Supabase PostgREST behind RLS, and the only credentials in play are the anon
 * key (public by design) and a user's session JWT. Issuing "API tokens" would
 * mean either:
 *
 * 1. handing out long-lived JWTs, a bearer credential with the user's full
 *    RLS scope, no expiry, no revocation list and no audit trail; or
 * 2. building a real personal-access-token system: a `api_tokens` table
 *    storing hashes, scopes, a revocation path, and a gateway that exchanges
 *    a token for a scoped database role.
 *
 * (1) is a security incident waiting to happen, a leaked token would grant
 * standing access to a whole organisation's staff PII with nothing to revoke
 * it and no record of its use. (2) is a project.
 *
 * A tab that renders "You have no tokens yet" beside a "Generate token" button
 * implies (1) exists and is merely unused. It does not exist, and this page
 * says so. The tab stays in the bar because the design has it and hiding it
 * would only prompt the same question later.
 */
export function TokensPage(): JSX.Element {
  return (
    <div className="max-w-3xl space-y-6">
      <SettingsSection
        title="API tokens"
        description="Personal tokens for using RotaFlow data from outside the app."
      >
        <EmptyState
          icon={KeyRound}
          title="RotaFlow has no public API yet"
          description="There is nothing to issue a token for. When an API exists, personal access tokens will be created and revoked here."
        />
      </SettingsSection>

      <Card className="bg-info/5">
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Need scheduling data elsewhere in the meantime? Reports can be exported as CSV
          and Excel from{' '}
          <span className="font-medium text-content dark:text-content-dark">Reports</span>
          , which covers most integrations without a standing credential.
        </p>
      </Card>
    </div>
  );
}
