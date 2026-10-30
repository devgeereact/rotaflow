import type { JSX } from 'react';
import { UserProfile } from '@clerk/clerk-react';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { env } from '@/lib/env';

/**
 * `/app/account/security`. Sign-in methods, the second factor, connected accounts and signed-in devices are all
 * Clerk's: RotaFlow keeps no passwords, factors or sessions of its own, so this page hosts Clerk's account screen
 * rather than re-implementing it. The old `/app/account/accounts` and `/app/account/sessions` routes land here.
 */
export function SecurityPage(): JSX.Element {
  return (
    <div className="max-w-4xl space-y-6">
      <SettingsSection
        title="Sign-in and security"
        description="Your email address, two-step verification, connected accounts and the devices signed in to your account."
      >
        {env.clerkPublishableKey ? (
          <UserProfile
            routing="hash"
            appearance={{
              elements: { rootBox: 'w-full', cardBox: 'w-full shadow-none' },
            }}
          />
        ) : (
          <p className="text-ink-muted dark:text-content-muted-dark">
            Sign-in settings are not available in this build.
          </p>
        )}
      </SettingsSection>
    </div>
  );
}
