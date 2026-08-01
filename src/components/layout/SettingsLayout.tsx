import { Suspense } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { RouteFallback } from '@/components/RouteFallback';
import { Card } from '@/components/ui/Card';
import { useOrg } from '@/hooks/useOrg';
import { settingsTabsForRole } from '@/lib/settingsTabs';

/**
 * `/app/settings/*` — the eight-section organisation administration area from
 * `design/SettingsOrganisation.png`.
 *
 * ## Why the tab bar lives in a layout route and not in each page
 *
 * `settingsTabs.ts` and the `Tabs` primitive both shipped earlier as "the
 * thing that unblocks the eleven remaining screens", and then nothing imported
 * them: `settingsTabs.ts` was referenced only by its own unit test, and every
 * one of its fourteen routes resolved to the `*` catch-all. The bar was
 * defined, tested and never rendered.
 *
 * Putting it in a layout route is what stops that recurring. A new section is
 * now a `<Route>` plus an entry in `SETTINGS_TABS`, and if either is missing
 * the gap is visible immediately — you either see a tab that 404s or a page
 * with no tab pointing at it. There is no state in which the bar silently
 * does not exist.
 */
export function SettingsLayout(): JSX.Element {
  const { role, orgName } = useOrg();
  const location = useLocation();

  const tabs = settingsTabsForRole(role);

  // Staff have no Settings sections at all (see settingsTabs.ts). Send them to
  // their own account rather than rendering an empty tab bar over a blank page.
  if (tabs.length === 0) return <Navigate to="/app/account/profile" replace />;

  const active = tabs.find((tab) => location.pathname.startsWith(tab.to));

  return (
    <div>
      <PageHeader
        title={active ? `Settings — ${active.label}` : 'Settings'}
        description={`Manage ${orgName || 'your organisation'}'s details, preferences and platform configuration.`}
        below={<Tabs items={tabs} label="Settings sections" />}
      />
      {/* Scoped Suspense: a boundary above this would unmount the tab bar
          while the next section's chunk loads, so every tab click would blank
          the header the user just clicked in. */}
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
    </div>
  );
}

/**
 * Shared "this section is owner-only" panel. Presentation only — RLS in
 * `0002_rotaflow.sql` is the real boundary and refuses regardless of what the
 * UI renders.
 */
export function OwnerOnlyNotice({ section }: { section: string }): JSX.Element {
  return (
    <Card>
      <p className="text-sm text-content-muted dark:text-content-muted-dark">
        Only the organisation owner can view {section}.
      </p>
    </Card>
  );
}
