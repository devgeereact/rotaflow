import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useFilterState } from '@/hooks/useFilterState';
import { useOperationalDate } from '@/hooks/useOperationalDate';
import { listLocations, listDepartments } from '@/services/locationService';
import { listStaff } from '@/services/staffService';
import { listJobTitles } from '@/services/jobTitleService';
import { getOrganisation } from '@/services/orgService';
import { loadAttendanceRange, type AttendanceRange } from '@/services/attendanceService';
import { correctClockEvent, listClockEventCorrections } from '@/services/clockService';
import { logAuditEvent } from '@/services/auditService';
import { downloadCsv } from '@/lib/csv';
import { reportError } from '@/lib/sentry';
import {
  applySort,
  filterValue,
  listOutcome,
  matchesFilters,
  paginate,
  type FilterOption,
} from '@/lib/filters';
import { matchesSearch } from '@/lib/filters';
import {
  ATTENDANCE_CSV_COLUMNS,
  ATTENDANCE_FILTERS,
  ATTENDANCE_SORTS,
  attendanceAccessors,
  attendanceStatusOptions,
  buildAttendanceViewRows,
  withUnassigned,
  type AttendanceViewRow,
} from '@/lib/attendanceRows';
import { nextDay, resolveReportingTimezone } from '@/lib/operationalDay';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatTile } from '@/components/ui/StatTile';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { AttendanceTable } from '@/components/attendance/AttendanceTable';
import {
  AttendanceDetailModal,
  type AttendanceCorrectionInput,
} from '@/components/attendance/AttendanceDetailModal';
import { ATTENDANCE_STATUS_META } from '@/lib/attendance';
import type {
  ClockEventCorrection,
  Department,
  JobTitle,
  Location,
  Organisation,
  StaffProfile,
} from '@/types';

const PAGE_SIZE = 50;

/**
 * `/app/attendance` — the managerial counterpart of the clock-in screen.
 *
 * ## Why this screen exists
 *
 * There was no attendance record in the product. The dashboard counted
 * rostered shifts and called it "On shift now"; the schedule counted a
 * different thing and called it the same; the timesheet screen showed one
 * week's totals and no event detail. Nobody could answer "did that person
 * actually turn up, and what does the evidence say" without opening the
 * database.
 *
 * ## What it does not claim
 *
 * Everything here is what reached the server. `docs/OFFLINE-SPEC.md` is
 * explicit that a queued clock-in lives on the device until it syncs, so an
 * empty row means "not recorded", never "absent", and the wording says so
 * everywhere the count is shown. A dashboard that reports absence it cannot
 * observe is worse than one that reports nothing.
 */
export function AttendancePage(): JSX.Element {
  const { orgId, orgName } = useOrg();
  const { canBuildRota } = usePermissions();
  const { showError, showSuccess } = useToast();

  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [data, setData] = useState<AttendanceRange | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [selected, setSelected] = useState<AttendanceViewRow | null>(null);
  const [corrections, setCorrections] = useState<ClockEventCorrection[]>([]);
  const [correctionsLoading, setCorrectionsLoading] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  const reporting = useMemo(
    () => resolveReportingTimezone(locations, null, organisation?.timezone ?? null),
    [locations, organisation],
  );
  // Rolls over at local midnight without a reload. An operations board left
  // open overnight showing yesterday is the failure this replaces.
  const today = useOperationalDate(reporting.timezone);

  /**
   * The period, read from the URL when one was supplied.
   *
   * The dashboard's tiles link here with `?from=&to=` plus the statuses they
   * counted, so a count and the list behind it are the same query. Without
   * this the link would land on today whatever it said, and a tile reading
   * "3 late tomorrow" would open an empty table.
   */
  const [searchParams] = useSearchParams();
  const urlFrom = searchParams.get('from');
  const urlTo = searchParams.get('to');
  const [fromDate, setFromDate] = useState(urlFrom ?? today);
  const [toDate, setToDate] = useState(urlTo ?? today);

  // Follow the operational date only while the range is still "today", so a
  // manager who has deliberately paged back to last Tuesday is not yanked
  // forward at midnight.
  useEffect(() => {
    // A period named in the URL is a deliberate choice and is left alone.
    if (urlFrom || urlTo) return;
    setFromDate((prev) => (prev < today ? prev : today));
    setToDate((prev) => (prev < today ? prev : today));
  }, [today, urlFrom, urlTo]);

  const allowedValues = useCallback(
    (dimensionId: string): readonly string[] | null => {
      switch (dimensionId) {
        case 'loc':
          return locations.map((l) => l.id);
        case 'dept':
          return departments.map((d) => d.id);
        case 'title':
          return jobTitles.map((t) => t.id);
        case 'person':
          return staff.map((s) => s.id);
        default:
          return null;
      }
    },
    [locations, departments, jobTitles, staff],
  );

  const filterApi = useFilterState({
    dimensions: ATTENDANCE_FILTERS,
    allowedValues,
    scopeKey: orgId ?? '',
    defaultSort: 'expected',
  });

  const loadReference = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    const [org, locs, depts, people, titles] = await Promise.all([
      getOrganisation(orgId),
      listLocations(orgId),
      listDepartments(orgId),
      listStaff(orgId),
      listJobTitles(orgId),
    ]);
    setOrganisation(org);
    setLocations(locs);
    setDepartments(depts);
    setStaff(people);
    setJobTitles(titles);
  }, [orgId]);

  const load = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    setLoading(true);
    setFailed(false);
    try {
      await loadReference();
      const range = await loadAttendanceRange({
        orgId,
        fromDate,
        toDate,
        timezone: reporting.timezone,
      });
      setData(range);
    } catch (error) {
      reportError(error, { area: 'attendance:load' });
      // Deliberately NOT `setData(null)` plus an empty table. A failed read
      // that renders as "no attendance" tells a manager nobody turned up.
      setFailed(true);
      showError('Could not load attendance. Check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }, [orgId, fromDate, toDate, reporting.timezone, loadReference, showError]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeRefresh({
    tables: ['clock_events', 'shifts', 'rotas'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => void load(),
  });

  const lookups = useMemo(
    () => ({
      staffById: new Map(staff.map((s) => [s.id, s])),
      locationById: new Map(locations.map((l) => [l.id, l])),
      departmentById: new Map(departments.map((d) => [d.id, d])),
      jobTitleById: new Map(jobTitles.map((t) => [t.id, t])),
      fallbackTimezone: reporting.timezone,
    }),
    [staff, locations, departments, jobTitles, reporting.timezone],
  );

  const allRows = useMemo(
    () => (data ? buildAttendanceViewRows(data.rows, lookups) : []),
    [data, lookups],
  );

  const accessors = useMemo(
    () => attendanceAccessors(lookups.staffById),
    [lookups.staffById],
  );

  const matched = useMemo(() => {
    const term = filterValue(filterApi.filters, 'q');
    return allRows.filter(
      (row) =>
        matchesFilters(row, filterApi.filters, accessors) &&
        matchesSearch(
          [row.name, row.jobTitleName, row.locationName, row.departmentName],
          term,
        ),
    );
  }, [allRows, filterApi.filters, accessors]);

  // Sort, then page. Never the other way round — paging first and sorting the
  // page is how a table shows the alphabetically-first fifty and calls it
  // sorted by exception severity.
  const sorted = useMemo(
    () =>
      applySort(
        matched,
        ATTENDANCE_SORTS.find((spec) => spec.id === filterApi.sort) ?? null,
        filterApi.direction,
        (row) => row.key,
      ),
    [matched, filterApi.sort, filterApi.direction],
  );

  const page = useMemo(
    () => paginate(sorted, filterApi.page, PAGE_SIZE),
    [sorted, filterApi.page],
  );

  const outcome = listOutcome({
    loading,
    failed,
    totalRows: allRows.length,
    matchedRows: matched.length,
  });

  const optionsFor = useCallback(
    (dimensionId: string): readonly FilterOption[] => {
      switch (dimensionId) {
        case 'loc':
          return withUnassigned(
            locations.map((l) => ({ value: l.id, label: l.name })),
            'No location',
          );
        case 'dept':
          return withUnassigned(
            departments.map((d) => ({ value: d.id, label: d.name })),
            'No department',
          );
        case 'title':
          return withUnassigned(
            jobTitles.map((t) => ({ value: t.id, label: t.name })),
            'No job title',
          );
        case 'person':
          return staff.map((s) => ({
            value: s.id,
            label: `${s.first_name} ${s.last_name}`,
          }));
        case 'status':
          return attendanceStatusOptions();
        default:
          return [];
      }
    },
    [locations, departments, jobTitles, staff],
  );

  const openRow = useCallback((row: AttendanceViewRow): void => {
    setSelected(row);
    setCorrectionError(null);
    const clockIn = row.row.events[0];
    if (!clockIn) {
      setCorrections([]);
      return;
    }
    setCorrectionsLoading(true);
    void listClockEventCorrections(clockIn.id)
      .then(setCorrections)
      .catch((error: unknown) => {
        reportError(error, { area: 'attendance:corrections' });
        setCorrections([]);
      })
      .finally(() => setCorrectionsLoading(false));
  }, []);

  const handleCorrect = useCallback(
    async (input: AttendanceCorrectionInput): Promise<void> => {
      if (!orgId) return;
      setCorrecting(true);
      setCorrectionError(null);
      try {
        await correctClockEvent(input.clockEventId, {
          reason: input.reason,
          eventAt: input.eventAt,
          expectedUpdatedAt: input.expectedUpdatedAt,
        });
        await logAuditEvent(
          orgId,
          'timesheet.amended',
          'clock_event',
          input.clockEventId,
          {
            reason: input.reason,
          },
        );
        showSuccess('Attendance corrected. The previous value has been kept.');
        setSelected(null);
        await load();
      } catch (error) {
        reportError(error, { area: 'attendance:correct' });
        const message = (error as { message?: string })?.message;
        // The database's own sentence where it wrote one for a person — a
        // stale write and a missing reason both say something actionable.
        // Anything else falls back rather than showing a Postgres string.
        setCorrectionError(
          typeof message === 'string' && message.length < 200
            ? message
            : 'Could not save that correction. Please try again.',
        );
      } finally {
        setCorrecting(false);
      }
    },
    [orgId, showSuccess, load],
  );

  /**
   * Export every matching row, not the page on screen.
   *
   * The notes carry the scope: which organisation, which dates, which
   * timezone, and how many rows. A column of `06:00`s in a file opened a week
   * later is unreadable without them.
   */
  const handleExport = useCallback((): void => {
    if (!orgId) return;
    downloadCsv(
      `rotaflow-attendance-${fromDate}-to-${toDate}`,
      sorted,
      [...ATTENDANCE_CSV_COLUMNS],
      {
        notes: [
          `Organisation: ${orgName ?? orgId}`,
          `Period: ${fromDate} to ${toDate} inclusive`,
          `Reporting timezone: ${reporting.timezone}${reporting.mixed ? ' (sites in this organisation use more than one timezone; each row states its own)' : ''}`,
          `Rows: ${sorted.length} of ${allRows.length} in the period, after the filters shown on screen`,
          'Attendance is what reached the server. "Not recorded" is not a record of absence.',
        ],
      },
    );
    void logAuditEvent(orgId, 'report.exported', 'attendance', undefined, {
      fromDate,
      toDate,
      rows: sorted.length,
    });
  }, [orgId, orgName, fromDate, toDate, sorted, allRows.length, reporting]);

  const counts = data?.counts ?? null;

  return (
    <div>
      <WorkspaceHeader
        title="Team Attendance"
        subtitle="Who actually clocked in, against who was rostered. Everything here is what has reached the server."
        primaryAction={
          <Button onClick={handleExport} disabled={sorted.length === 0}>
            <Download size={16} aria-hidden="true" />
            Export {sorted.length} row{sorted.length === 1 ? '' : 's'}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-content-muted dark:text-content-muted-dark">
            From
          </span>
          <input
            type="date"
            value={fromDate}
            max={toDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-11 rounded-xl border border-surface-border bg-surface px-3 text-content dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-content-muted dark:text-content-muted-dark">
            To
          </span>
          <input
            type="date"
            value={toDate}
            min={fromDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-11 rounded-xl border border-surface-border bg-surface px-3 text-content dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
          />
        </label>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setFromDate(today);
              setToDate(today);
            }}
          >
            Today
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setFromDate(nextDay(today));
              setToDate(nextDay(today));
            }}
          >
            Tomorrow
          </Button>
        </div>
        <p className="ml-auto text-xs text-content-muted dark:text-content-muted-dark">
          {data
            ? `Updated ${new Date(data.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
            : 'Not loaded'}
          {failed ? ' · last read failed' : ''}
        </p>
      </div>

      {counts && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <StatTile
            compact
            label="Scheduled people"
            value={counts.scheduledPeople}
            hint={`${counts.scheduledShifts} shift${counts.scheduledShifts === 1 ? '' : 's'}`}
          />
          <StatTile
            compact
            label="Working"
            value={counts.workingNow}
            hint={ATTENDANCE_STATUS_META.working.definition}
          />
          <StatTile
            compact
            label="On break"
            value={counts.onBreak}
            hint={ATTENDANCE_STATUS_META.on_break.definition}
          />
          <StatTile compact label="Completed" value={counts.completed} />
          <StatTile
            compact
            label="Late"
            value={counts.late}
            hint={ATTENDANCE_STATUS_META.late.definition}
          />
          <StatTile
            compact
            label="Needs review"
            value={counts.missingClockOut + counts.notRecorded + counts.unscheduled}
            hint="missing clock-out, not recorded, or unscheduled"
          />
        </div>
      )}

      <FilterBar
        dimensions={ATTENDANCE_FILTERS}
        filters={filterApi.filters}
        optionsFor={optionsFor}
        onSetValue={filterApi.setValue}
        onSetValues={filterApi.setValues}
        onClearOne={filterApi.clearOne}
        onClearAll={filterApi.clearAll}
        searchPlaceholder="Search people, titles or sites"
        resultSummary={
          outcome === 'rows'
            ? `Showing ${page.from}-${page.to} of ${page.total}`
            : outcome === 'no-match'
              ? '0 of ' + allRows.length
              : ''
        }
        droppedDimensions={filterApi.droppedDimensions}
        onDismissDropped={filterApi.dismissDropped}
      />

      {outcome === 'loading' && (
        <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
      )}

      {outcome === 'error' && (
        <Card className="max-w-md">
          <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
            Attendance could not be read. This is not the same as nobody being rostered —
            nothing is known either way until it loads.
          </p>
          <Button onClick={() => void load()}>Retry</Button>
        </Card>
      )}

      {outcome === 'empty-dataset' && (
        <EmptyState
          title="Nothing rostered in this period"
          description="Attendance appears here once a published rota covers these dates and people start clocking in."
        />
      )}

      {outcome === 'no-match' && (
        <EmptyState
          title="No attendance matches these filters"
          description={`${allRows.length} row${allRows.length === 1 ? '' : 's'} in this period. Widen the search or clear the filters.`}
          action={<Button onClick={filterApi.clearAll}>Clear filters</Button>}
        />
      )}

      {outcome === 'rows' && (
        <>
          <AttendanceTable
            rows={page.rows}
            sorts={ATTENDANCE_SORTS}
            sort={filterApi.sort}
            direction={filterApi.direction}
            onSort={filterApi.setSort}
            onOpen={openRow}
            mixedTimezoneNote={
              reporting.mixed
                ? `Sites in this organisation use more than one timezone. Dates are grouped in ${reporting.timezone}; each row's times are in its own site's.`
                : null
            }
          />

          {page.pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3">
              <Button
                variant="secondary"
                disabled={page.page <= 1}
                onClick={() => filterApi.setPage(page.page - 1)}
              >
                Previous
              </Button>
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                Page {page.page} of {page.pageCount}
              </p>
              <Button
                variant="secondary"
                disabled={page.page >= page.pageCount}
                onClick={() => filterApi.setPage(page.page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}

      <AttendanceDetailModal
        open={selected !== null}
        onClose={() => setSelected(null)}
        row={selected}
        corrections={corrections}
        correctionsLoading={correctionsLoading}
        busy={correcting}
        error={correctionError}
        onCorrect={canBuildRota ? (input) => void handleCorrect(input) : null}
      />
    </div>
  );
}
