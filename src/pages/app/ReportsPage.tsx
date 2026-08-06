import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarRange, Download, Timer, Users } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { PermissionDenied } from '@/components/PermissionDenied';
import { useToast } from '@/hooks/useToast';
import { reportError } from '@/lib/sentry';
import { ReportsView } from '@/components/reports/ReportsView';
import { ReportsAnalyticsCard } from '@/components/reports/ReportsAnalyticsCard';
import {
  REPORT_CATALOGUE,
  REPORT_RANGES,
  rangeFileSuffix,
  resolveRange,
  type ReportDefinition,
  type ReportRangeId,
} from '@/lib/reportsCatalogue';
import {
  formatRunLabel,
  readFavourites,
  readRuns,
  recordRun,
  toggleFavourite,
  type ReportRunRecord,
} from '@/lib/reportPrefs';
import type { ReportPeriod } from '@/services/reportsService';
import type { ReportRow } from '@/lib/reportRows';
import type { ReportsTab } from '@/components/reports/ReportsTabs';
import type { RecentReport } from '@/components/reports/RecentReportsCard';
import type { ReportsOverviewSegment } from '@/components/reports/ReportsOverviewCard';
import type { ReportQuickAction } from '@/components/reports/ReportsQuickActionsCard';

/**
 * `/app/reports`. The reporting workspace (design/Reports-Dashboard.png).
 *
 * Every row is an export that genuinely exists: the catalogue in
 * `src/lib/reportsCatalogue.ts` maps one-to-one onto `reportsService` queries,
 * and RLS already scopes each of them to this organisation, so the CSV is
 * produced entirely client-side. "Last Run", the overview split and the Recent
 * Reports rail come from this browser's own run log, no server-side run
 * history exists to read (see `src/lib/reportPrefs.ts`).
 */
export function ReportsPage(): JSX.Element {
  const { orgId, orgName } = useOrg();
  const { canManageStaff } = usePermissions();
  const { showError, showSuccess } = useToast();

  const [activeTab, setActiveTab] = useState<ReportsTab>('all');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [format, setFormat] = useState('');
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [rangeId, setRangeId] = useState<ReportRangeId>('this-month');

  /**
   * The window the charts read. Recomputed only when the range or the org
   * changes, `new Date()` inside the memo would give it a new identity on
   * every render and refetch the charts in a loop.
   */
  const analyticsPeriod = useMemo<ReportPeriod | null>(() => {
    if (!orgId) return null;
    const { from, to } = resolveRange(rangeId, new Date());
    return { orgId, fromIso: from.toISOString(), toIso: to.toISOString() };
  }, [orgId, rangeId]);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [favourites, setFavourites] = useState<string[]>(() =>
    orgId ? readFavourites(orgId) : [],
  );
  const [runs, setRuns] = useState<ReportRunRecord[]>(() =>
    orgId ? readRuns(orgId) : [],
  );

  // `useState` initialisers run once, but `orgId` is null until OrgContext
  // resolves and changes again when the user switches organisation, without
  // this, one org's starred reports and run log would show under another.
  useEffect(() => {
    setFavourites(orgId ? readFavourites(orgId) : []);
    setRuns(orgId ? readRuns(orgId) : []);
  }, [orgId]);

  const rangeLabel =
    REPORT_RANGES.find((range) => range.id === rangeId)?.label ?? 'This Month';
  const scopeLabel = `${orgName ?? 'All locations'} · ${rangeLabel}`;

  const runReport = useCallback(
    async (report: ReportDefinition): Promise<boolean> => {
      if (!orgId) return false;
      const { from, to } = resolveRange(rangeId, new Date());
      const period: ReportPeriod = {
        orgId,
        fromIso: from.toISOString(),
        toIso: to.toISOString(),
      };
      try {
        await report.run(period, rangeFileSuffix({ from, to }));
        setRuns(
          recordRun(orgId, {
            reportId: report.id,
            name: report.name,
            category: report.category,
            scope: scopeLabel,
            format: report.format,
            ok: true,
          }),
        );
        return true;
      } catch (err) {
        reportError(err, { area: `reports:${report.id}` });
        setRuns(
          recordRun(orgId, {
            reportId: report.id,
            name: report.name,
            category: report.category,
            scope: scopeLabel,
            format: report.format,
            ok: false,
          }),
        );
        return false;
      }
    },
    [orgId, rangeId, scopeLabel],
  );

  const handleRun = useCallback(
    (id: string): void => {
      const report = REPORT_CATALOGUE.find((item) => item.id === id);
      if (!report || runningId !== null) return;
      setRunningId(id);
      void runReport(report)
        .then((ok) => {
          if (ok) showSuccess(`${report.name} exported.`);
          else
            showError(`Could not export ${report.name.toLowerCase()}. Please try again.`);
        })
        .finally(() => setRunningId(null));
    },
    [runningId, runReport, showError, showSuccess],
  );

  const handleBulkExport = useCallback((): void => {
    if (runningId !== null) return;
    setRunningId('bulk');
    void (async () => {
      let failures = 0;
      for (const report of REPORT_CATALOGUE) {
        const ok = await runReport(report);
        if (!ok) failures += 1;
      }
      if (failures === 0) showSuccess(`All ${REPORT_CATALOGUE.length} reports exported.`);
      else
        showError(
          `${failures} of ${REPORT_CATALOGUE.length} reports could not be exported.`,
        );
      setRunningId(null);
    })();
  }, [runningId, runReport, showError, showSuccess]);

  const handleToggleFavourite = useCallback(
    (id: string): void => {
      if (!orgId) return;
      setFavourites(toggleFavourite(orgId, id));
    },
    [orgId],
  );

  const lastRunByReport = useMemo(() => {
    const map = new Map<string, ReportRunRecord>();
    for (const run of runs) if (!map.has(run.reportId)) map.set(run.reportId, run);
    return map;
  }, [runs]);

  const rows: ReportRow[] = useMemo(() => {
    const term = search.trim().toLowerCase();
    return REPORT_CATALOGUE.filter((report) => {
      if (activeTab === 'favourites' && !favourites.includes(report.id)) return false;
      if (favouritesOnly && !favourites.includes(report.id)) return false;
      if (category && report.category !== category) return false;
      if (format && report.format !== format) return false;
      if (term && !`${report.name} ${report.description}`.toLowerCase().includes(term))
        return false;
      return true;
    }).map((report) => {
      const last = lastRunByReport.get(report.id);
      return {
        id: report.id,
        name: report.name,
        category: report.category,
        description: report.description,
        icon: report.icon,
        lastRunLabel: last ? formatRunLabel(last.at) : null,
        lastRunBy: last ? last.scope : null,
        frequency: 'On demand',
        format: report.format,
        favourite: favourites.includes(report.id),
        runnable: true,
      };
    });
  }, [activeTab, search, category, format, favouritesOnly, favourites, lastRunByReport]);

  const periodRuns = useMemo(() => {
    const { from, to } = resolveRange(rangeId, new Date());
    return runs.filter((run) => {
      const at = new Date(run.at);
      return at >= from && at < to;
    });
  }, [runs, rangeId]);

  const overview: ReportsOverviewSegment[] = useMemo(() => {
    const generated = periodRuns.filter((run) => run.ok).length;
    const failed = periodRuns.length - generated;
    const total = periodRuns.length;
    const pct = (n: number): number => (total === 0 ? 0 : Math.round((n / total) * 100));
    return [
      {
        id: 'generated',
        label: 'Generated',
        value: generated,
        percent: pct(generated),
        strokeClass: 'stroke-success',
        dotClass: 'bg-success',
      },
      {
        id: 'failed',
        label: 'Failed',
        value: failed,
        percent: pct(failed),
        strokeClass: 'stroke-danger',
        dotClass: 'bg-danger',
      },
    ];
  }, [periodRuns]);

  const categoryOptions = useMemo(
    () =>
      [...new Set(REPORT_CATALOGUE.map((report) => report.category))].map((name) => ({
        value: name,
        label: name,
      })),
    [],
  );

  const recent: RecentReport[] = useMemo(
    () =>
      runs.slice(0, 4).map((run) => ({
        id: run.id,
        name: run.name,
        icon:
          REPORT_CATALOGUE.find((report) => report.id === run.reportId)?.icon ?? Download,
        category: run.category,
        scope: run.scope,
        runLabel: formatRunLabel(run.at),
        format: run.format,
      })),
    [runs],
  );

  // Only destinations that exist. The reference also offers "Schedule Report",
  // "Report Builder" and "Report Settings"; none of the three is built, so none
  // is offered here rather than linking somewhere that cannot answer.
  const quickActions: ReportQuickAction[] = [
    {
      id: 'bulk',
      icon: Download,
      label: 'Bulk Export',
      description: `Export all ${REPORT_CATALOGUE.length} reports`,
      onClick: handleBulkExport,
    },
    {
      id: 'timesheets',
      icon: Timer,
      label: 'Timesheets',
      description: 'Review and approve hours',
      to: '/app/timesheets',
    },
    {
      id: 'schedule',
      icon: CalendarRange,
      label: 'Published Schedule',
      description: 'See the live rota',
      to: '/app/schedule',
    },
    {
      id: 'staff',
      icon: Users,
      label: 'Staff Directory',
      description: 'People and documents',
      to: '/app/team',
    },
  ];

  // Belt and braces behind the route's own `RequireRole` gate: this page is
  // also reachable by a future route that forgets to declare one. `RequireRole`
  // renders the full explanation (role held, role required, way back). This
  // just makes sure the manager UI never renders for a non-manager.
  if (!canManageStaff) {
    return <PermissionDenied area="reports" allowed={['owner', 'manager']} />;
  }

  return (
    <ReportsView
      analytics={
        <ReportsAnalyticsCard period={analyticsPeriod} rangeLabel={scopeLabel} />
      }
      tabs={[
        { value: 'all', label: 'All Reports' },
        { value: 'favourites', label: 'Favourites', count: favourites.length },
      ]}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      search={search}
      onSearchChange={setSearch}
      categories={categoryOptions}
      category={category}
      onCategoryChange={setCategory}
      formats={[{ value: 'CSV', label: 'CSV' }]}
      format={format}
      onFormatChange={setFormat}
      favouritesOnly={favouritesOnly}
      onFavouritesOnlyChange={setFavouritesOnly}
      rows={rows}
      onToggleFavourite={handleToggleFavourite}
      onRun={handleRun}
      onDownload={handleRun}
      runningId={runningId}
      emptyMessage="No reports match these filters."
      overview={overview}
      overviewTotal={periodRuns.length}
      overviewRanges={REPORT_RANGES.map((range) => ({
        value: range.id,
        label: range.label,
      }))}
      overviewRange={rangeId}
      onOverviewRangeChange={(value) => setRangeId(value as ReportRangeId)}
      overviewEmptyMessage="No reports generated in this period yet."
      recent={recent}
      recentEmptyMessage="Reports you generate here will be listed."
      quickActions={quickActions}
      tipTitle={`Every export covers ${rangeLabel.toLowerCase()}`}
      tipBody="Change the period in Reports Overview, then run a report to download it as a CSV."
      tipActionLabel="Export all reports"
      tipActionIcon={Download}
      onTipAction={handleBulkExport}
    />
  );
}
