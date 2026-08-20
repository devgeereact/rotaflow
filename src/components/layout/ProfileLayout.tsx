import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { RouteFallback } from '@/components/RouteFallback';
import { profileTabs } from '@/lib/settingsTabs';

/**
 * `/app/account/*`. The six-section personal area from
 * `docs/design/ProfileSettings.png`.
 *
 * Every signed-in user has one regardless of role, which is the whole reason
 * it is separate from Settings: Settings is organisation administration and a
 * staff member sees none of it, but everyone needs their own password, their
 * own notification preferences and their own sessions.
 */
export function ProfileLayout(): JSX.Element {
  return (
    <div>
      <PageHeader
        title="My Profile"
        description="Manage your personal information, preferences and security."
        below={<Tabs items={profileTabs()} label="Profile sections" />}
      />
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
