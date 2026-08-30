import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { BarChart3 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import { BarChart, type BarGroup } from '@/components/ui/BarChart';
import {
  getLeaveReportRows,
  getShiftReportRows,
  getTimesheetReportRows,
} from '@/services/reportsService';
import type { ReportPeriod } from '@/services/reportsService';
import { listShiftsForPeriod } from '@/services/shiftService';
import { listDepartments, listMinimumCoverRulesForOrg } from '@/services/locationService';
import { listOrgOvertimeRequests } from '@/services/overtimeService';
import {
  absenceReasons,
  countAbsenceDays,
  countCoverShortfalls,
  hoursByDepartment,
  sumHoursWorked,
  sumOvertimeHours,
  type AbsenceReasonRow,
  type DepartmentHoursRow,
} from '@/lib/reportsOverview';
import { reportError } from '@/lib/sentry';

interface ReportsAnalyticsCardProps {
  period: ReportPeriod | null;
  /** Shown above the charts so the figures are never read out of context. */
  rangeLabel: string;
}

function BarRows({
  rows,
  valueOf,
  suffix,
}: {
  rows: { id: string; label: string }[];
  valueOf: (id: string) => number;
  suffix: string;
}): JSX.Element {
  const max = Math.max(1, ...rows.map((r) => valueOf(r.id)));
  return (
    <div className="space-y-2.5">
      {rows.map((row) => {
        const value = valueOf(row.id);
        return (
          <div
            key={row.id}
            className="grid grid-cols-[7rem_1fr_4rem] items-center gap-2.5"
          >
            <span className="truncate text-xs text-content-muted dark:text-content-muted-dark">
              {row.label}
            </span>
            <span className="h-2 overflow-hidden rounded-full border border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${(value / max) * 100}%` }}
              />
            </span>
            <span className="text-right font-mono text-xs text-content dark:text-content-dark">
              {value}
              {suffix}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The tiles and charts `SCREENS.reports` opens with, scoped honestly.
 *
 * Staff cost and Agency spend are in the reference and are deliberately
 * absent: no pay-rate column exists anywhere in the schema (`docs/SCHEMA.md`),
 * so a cost figure would be an invented number presented with the authority
 * of a report. Four tiles ship instead of six, all backed by rows the rest
 * of the app already reads and writes — Hours worked reuses the same
 * `pairClockEvents` math `/app/timesheets` shows, so this card cannot
 * disagree with the screen it is reporting on.
 */
export function ReportsAnalyticsCard({
  period,
  rangeLabel,
}: ReportsAnalyticsCardProps): JSX.Element {
  const [hours, setHours] = useState<{ date: string; hours: number }[]>([]);
  const [shifts, setShifts] = useState<{ date: string }[]>([]);
  const [tiles, setTiles] = useState<{
    hoursWorked: number;
    overtimeHours: number;
    absenceDays: number;
    coverShortfalls: number;
  } | null>(null);
  const [departmentRows, setDepartmentRows] = useState<DepartmentHoursRow[]>([]);
  const [absenceRows, setAbsenceRows] = useState<AbsenceReasonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!period) return;
    let active = true;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const [
          timesheetRows,
          shiftRows,
          rawShifts,
          coverRules,
          overtimeRequests,
          leaveRows,
          departments,
        ] = await Promise.all([
          getTimesheetReportRows(period),
          getShiftReportRows(period),
          listShiftsForPeriod({
            orgId: period.orgId,
            fromIso: period.fromIso,
            toIso: period.toIso,
            publishedOnly: true,
          }),
          listMinimumCoverRulesForOrg(period.orgId),
          listOrgOvertimeRequests(period.orgId),
          getLeaveReportRows(period),
          listDepartments(period.orgId),
        ]);
        if (!active) return;
        setHours(
          timesheetRows.map((r) => ({ date: r.date, hours: Number(r.hours) || 0 })),
        );
        setShifts(shiftRows.map((r) => ({ date: r.date })));
        setTiles({
          hoursWorked: Math.round(sumHoursWorked(rawShifts)),
          overtimeHours: Math.round(
            sumOvertimeHours(overtimeRequests, period.fromIso, period.toIso),
          ),
          absenceDays: countAbsenceDays(leaveRows),
          coverShortfalls: countCoverShortfalls(rawShifts, coverRules),
        });
        setDepartmentRows(hoursByDepartment(rawShifts, departments));
        setAbsenceRows(absenceReasons(leaveRows));
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'reports:analytics' });
        setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [period]);

  const overtimePercent =
    tiles && tiles.hoursWorked > 0
      ? Math.round((tiles.overtimeHours / tiles.hoursWorked) * 1000) / 10
      : 0;

  /** Bucket by day, in date order, with the date pre-formatted for the axis. */
  const hourGroups = useMemo<BarGroup[]>(() => {
    const byDay = new Map<string, number>();
    for (const row of hours) {
      byDay.set(row.date, (byDay.get(row.date) ?? 0) + row.hours);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, total]) => ({
        label: format(new Date(`${date}T00:00:00`), 'd MMM'),
        values: [Math.round(total * 10) / 10],
      }));
  }, [hours]);

  const shiftGroups = useMemo<BarGroup[]>(() => {
    const byDay = new Map<string, number>();
    for (const row of shifts) {
      const day = row.date.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, count]) => ({
        label: format(new Date(`${date}T00:00:00`), 'd MMM'),
        values: [count],
      }));
  }, [shifts]);

  const body = (): JSX.Element => {
    if (loading) {
      return (
        <div className="space-y-3" aria-busy="true">
          <div className="h-24 animate-pulse rounded-xl bg-surface-subtle dark:bg-surface-subtle-dark" />
          <div className="h-40 animate-pulse rounded-xl bg-surface-subtle dark:bg-surface-subtle-dark" />
        </div>
      );
    }
    if (failed) {
      return (
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Could not load the figures for this range. This is a connection problem. The
          reports below still run.
        </p>
      );
    }
    return (
      <>
        {tiles && (
          <TileGrid className="mb-5">
            <StatTile label="Hours worked" value={tiles.hoursWorked} suffix="h" />
            <StatTile
              label="Overtime"
              value={tiles.overtimeHours}
              suffix="h"
              hint={`${overtimePercent}% of hours worked`}
            />
            <StatTile label="Absence" value={tiles.absenceDays} suffix=" days" />
            <StatTile label="Cover shortfalls" value={tiles.coverShortfalls} />
          </TileGrid>
        )}

        {hourGroups.length === 0 && shiftGroups.length === 0 ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            No clock events or shifts fall in {rangeLabel.toLowerCase()}. Pick a wider
            range, or check the rota has been published.
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="min-w-0">
              <h3 className="mb-1 text-sm font-semibold text-content dark:text-content-dark">
                Hours worked per day
              </h3>
              <p className="mb-3 text-xs text-content-muted dark:text-content-muted-dark">
                From paired clock in/out events, net of breaks.
              </p>
              {hourGroups.length > 0 ? (
                <BarChart
                  title="Hours worked per day"
                  unit="h"
                  series={[{ id: 'hours', label: 'Hours worked' }]}
                  groups={hourGroups}
                />
              ) : (
                <p className="text-sm text-content-muted dark:text-content-muted-dark">
                  No clock events in this range.
                </p>
              )}
            </div>
            <div className="min-w-0">
              <h3 className="mb-1 text-sm font-semibold text-content dark:text-content-dark">
                Shifts scheduled per day
              </h3>
              <p className="mb-3 text-xs text-content-muted dark:text-content-muted-dark">
                Every shift on the rota, assigned or still open.
              </p>
              {shiftGroups.length > 0 ? (
                <BarChart
                  title="Shifts scheduled per day"
                  series={[{ id: 'shifts', label: 'Shifts' }]}
                  groups={shiftGroups}
                />
              ) : (
                <p className="text-sm text-content-muted dark:text-content-muted-dark">
                  No shifts in this range.
                </p>
              )}
            </div>
          </div>
        )}

        {(departmentRows.length > 0 || absenceRows.length > 0) && (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {departmentRows.length > 0 && (
              <div className="min-w-0">
                <h3 className="mb-3 text-sm font-semibold text-content dark:text-content-dark">
                  Hours by department
                </h3>
                <BarRows
                  rows={departmentRows}
                  valueOf={(id) => departmentRows.find((r) => r.id === id)?.hours ?? 0}
                  suffix="h"
                />
              </div>
            )}
            {absenceRows.length > 0 && (
              <div className="min-w-0">
                <h3 className="mb-3 text-sm font-semibold text-content dark:text-content-dark">
                  Absence reasons
                </h3>
                <BarRows
                  rows={absenceRows}
                  valueOf={(id) => absenceRows.find((r) => r.id === id)?.days ?? 0}
                  suffix="d"
                />
              </div>
            )}
          </div>
        )}
      </>
    );
  };

  return (
    <Card className="mb-4 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-card-heading font-semibold text-content dark:text-content-dark">
          <BarChart3
            size={16}
            aria-hidden="true"
            className="text-primary dark:text-primary-ink-dark"
          />
          Workforce trends
        </h2>
        <span className="text-xs text-content-muted dark:text-content-muted-dark">
          {rangeLabel} · last 14 days with data
        </span>
      </div>
      {body()}
    </Card>
  );
}
