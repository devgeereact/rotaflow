import { Tabs, type TabItem } from '@/components/ui/Tabs';

/** Which half of the merged workspace is on screen. */
export type LocationsWorkspaceTab = 'locations' | 'departments';

const COPY: Record<LocationsWorkspaceTab, { title: string; subtitle: string }> = {
  locations: {
    title: 'Locations',
    subtitle: 'Manage your sites, venues and service locations.',
  },
  departments: {
    title: 'Departments',
    subtitle: 'Manage departments and service areas across your organisation.',
  },
};

/**
 * Title, subtitle and the Locations / Departments switch.
 *
 * The two references are separate full screens with the same skeleton; the
 * brief merges them, and this strip is the seam. It appears in neither PNG —
 * see design/.loop/locations-log.md.
 *
 * These are **routes**, not in-page panels, so it uses `ui/Tabs` rather than
 * `ui/PanelTabs`: a manager linking a colleague to the departments view, or
 * refreshing on it, has to land back on it.
 */
export function LocationsWorkspaceHeader({
  tab,
  basePath,
}: {
  tab: LocationsWorkspaceTab;
  /** `/app/locations` in the product, `/locations-preview` in the design loop. */
  basePath: string;
}): JSX.Element {
  const items: TabItem[] = [
    { to: basePath, label: 'Locations' },
    { to: `${basePath}/departments`, label: 'Departments' },
  ];

  return (
    <div className="mb-6">
      <h1 className="font-display text-page-title font-semibold text-content dark:text-content-dark">
        {COPY[tab].title}
      </h1>
      <p className="mt-1.5 text-sm text-content-muted dark:text-content-muted-dark">
        {COPY[tab].subtitle}
      </p>
      <Tabs items={items} label="Locations workspace sections" className="mt-4" />
    </div>
  );
}
