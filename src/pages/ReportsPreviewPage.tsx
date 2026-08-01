import { useState } from 'react';
import { BarChart3, CalendarDays, Download, Settings } from 'lucide-react';
import { ReportsView } from '@/components/reports/ReportsView';
import { DEMO_OVERVIEW, DEMO_RECENT_REPORTS, DEMO_REPORTS } from '@/lib/reportsDemo';
import type { ReportsTab } from '@/components/reports/ReportsTabs';
import type { ReportQuickAction } from '@/components/reports/ReportsQuickActionsCard';

/**
 * Design-loop preview only — `/app/reports` needs a real Supabase session and a
 * seeded organisation. This renders the same components against the fixtures in
 * `src/lib/reportsDemo.ts`, reproducing design/Reports-Dashboard.png. Not wired
 * to any service call; see design/.loop/reports-log.md.
 */

const noop = (): void => {};

const QUICK_ACTIONS: ReportQuickAction[] = [
  {
    id: 'schedule',
    icon: CalendarDays,
    label: 'Schedule Report',
    description: 'Automate reports delivery',
    onClick: noop,
  },
  {
    id: 'builder',
    icon: BarChart3,
    label: 'Report Builder',
    description: 'Create a custom report',
    onClick: noop,
  },
  {
    id: 'bulk',
    icon: Download,
    label: 'Bulk Export',
    description: 'Export multiple reports',
    onClick: noop,
  },
  {
    id: 'settings',
    icon: Settings,
    label: 'Report Settings',
    description: 'Manage categories & formats',
    onClick: noop,
  },
];

export function ReportsPreviewPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<ReportsTab>('all');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [format, setFormat] = useState('');
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [range, setRange] = useState('month');

  return (
    <div className="min-h-screen bg-background px-6 py-7 dark:bg-background-dark">
      <ReportsView
        tabs={[
          { value: 'all', label: 'All Reports' },
          { value: 'favourites', label: 'Favourites' },
          { value: 'scheduled', label: 'Scheduled Reports' },
          { value: 'custom', label: 'Custom Reports' },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onFilters={noop}
        onCustomReport={noop}
        search={search}
        onSearchChange={setSearch}
        categories={[
          { value: 'scheduling', label: 'Scheduling' },
          { value: 'staffing', label: 'Staffing' },
          { value: 'finance', label: 'Finance' },
        ]}
        category={category}
        onCategoryChange={setCategory}
        locations={[
          { value: 'sunnyvale', label: 'Sunnyvale Care Home' },
          { value: 'riverside', label: 'Riverside House' },
        ]}
        location={location}
        onLocationChange={setLocation}
        formats={[
          { value: 'pdf', label: 'PDF' },
          { value: 'excel', label: 'Excel' },
        ]}
        format={format}
        onFormatChange={setFormat}
        favouritesOnly={favouritesOnly}
        onFavouritesOnlyChange={setFavouritesOnly}
        rows={DEMO_REPORTS}
        onToggleFavourite={noop}
        onRun={noop}
        onDownload={noop}
        onRowMenu={noop}
        runningId={null}
        emptyMessage="No reports match these filters."
        overview={DEMO_OVERVIEW}
        overviewTotal={28}
        overviewRanges={[
          { value: 'month', label: 'This Month' },
          { value: 'week', label: 'This Week' },
        ]}
        overviewRange={range}
        onOverviewRangeChange={setRange}
        overviewEmptyMessage="No reports generated in this period yet."
        recent={DEMO_RECENT_REPORTS}
        onViewAllRecent={noop}
        recentEmptyMessage="Nothing generated yet."
        quickActions={QUICK_ACTIONS}
        tipTitle="Tip: Schedule reports to your inbox"
        tipBody="Set up recurring reports and have them delivered automatically."
        tipActionLabel="Schedule a Report"
        tipActionIcon={CalendarDays}
        onTipAction={noop}
      />
    </div>
  );
}
