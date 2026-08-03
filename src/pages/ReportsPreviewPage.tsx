import { useMemo, useState } from 'react';
import { BarChart3, CalendarDays, Download, Settings } from 'lucide-react';
import { ReportsView } from '@/components/reports/ReportsView';
import { DEMO_OVERVIEW, DEMO_RECENT_REPORTS, DEMO_REPORTS } from '@/lib/reportsDemo';
import { Card } from '@/components/ui/Card';
import { BarChart } from '@/components/ui/BarChart';
import type { ReportRow } from '@/lib/reportRows';
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
  const [favourites, setFavourites] = useState<string[]>(() =>
    DEMO_REPORTS.filter((report) => report.favourite).map((report) => report.id),
  );

  // The controls really filter, so the preview exercises the empty state and
  // the starred/unstarred rows rather than only re-rendering its own chrome.
  // Defaults are wide open, so the first paint is the reference exactly.
  const rows: ReportRow[] = useMemo(() => {
    const term = search.trim().toLowerCase();
    return DEMO_REPORTS.filter((report) => {
      if (activeTab === 'favourites' && !favourites.includes(report.id)) return false;
      if (favouritesOnly && !favourites.includes(report.id)) return false;
      if (category && report.category !== category) return false;
      if (format && report.format !== format) return false;
      if (term && !`${report.name} ${report.description}`.toLowerCase().includes(term))
        return false;
      return true;
    }).map((report) => ({ ...report, favourite: favourites.includes(report.id) }));
  }, [activeTab, favourites, favouritesOnly, category, format, search]);

  return (
    <div className="min-h-screen bg-background px-6 py-7 dark:bg-background-dark">
      <ReportsView
        // Design-loop only: the live card fetches from Supabase, which a
        // preview route has no session for. Fixed figures so the chart's
        // geometry, legend and tooltip can be compared to a reference.
        analytics={
          <Card className="mb-4 p-5">
            <h2 className="mb-4 text-card-heading font-semibold text-content dark:text-content-dark">
              Workforce trends
            </h2>
            <div className="grid gap-6 lg:grid-cols-2">
              <BarChart
                title="Hours worked per day"
                unit="h"
                series={[{ id: 'hours', label: 'Hours worked' }]}
                groups={[
                  { label: '1 Aug', values: [182.5] },
                  { label: '2 Aug', values: [201] },
                  { label: '3 Aug', values: [164.5] },
                  { label: '4 Aug', values: [220] },
                  { label: '5 Aug', values: [198] },
                  { label: '6 Aug', values: [176.5] },
                  { label: '7 Aug', values: [143] },
                ]}
              />
              <BarChart
                title="Shifts by status"
                series={[
                  { id: 'assigned', label: 'Assigned' },
                  { id: 'open', label: 'Open' },
                ]}
                groups={[
                  { label: '1 Aug', values: [24, 3] },
                  { label: '2 Aug', values: [26, 1] },
                  { label: '3 Aug', values: [21, 5] },
                  { label: '4 Aug', values: [28, 2] },
                  { label: '5 Aug', values: [25, 4] },
                  { label: '6 Aug', values: [22, 6] },
                  { label: '7 Aug', values: [18, 7] },
                ]}
              />
            </div>
          </Card>
        }
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
          { value: 'Scheduling', label: 'Scheduling' },
          { value: 'Staffing', label: 'Staffing' },
          { value: 'Finance', label: 'Finance' },
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
          { value: 'PDF', label: 'PDF' },
          { value: 'Excel', label: 'Excel' },
        ]}
        format={format}
        onFormatChange={setFormat}
        favouritesOnly={favouritesOnly}
        onFavouritesOnlyChange={setFavouritesOnly}
        rows={rows}
        onToggleFavourite={(id) =>
          setFavourites((current) =>
            current.includes(id)
              ? current.filter((value) => value !== id)
              : [...current, id],
          )
        }
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
