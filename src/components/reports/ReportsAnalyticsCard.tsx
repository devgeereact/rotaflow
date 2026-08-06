import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { BarChart3 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { BarChart, type BarGroup } from '@/components/ui/BarChart';
import { getShiftReportRows, getTimesheetReportRows } from '@/services/reportsService';
import type { ReportPeriod } from '@/services/reportsService';
import { reportError } from '@/lib/sentry';

interface ReportsAnalyticsCardProps {
  period: ReportPeriod | null;
  /** Shown above the charts so the figures are never read out of context. */
  rangeLabel: string;
}

/**
 * The charts §17 asks for ("Provide: Summary cards, **Charts**, Data tables,
 * Download actions"). The screen had the other three.
 *
 * ## Why these two measures
 *
 * They are the two the underlying queries can answer honestly over a date
 * range: hours actually worked (from paired clock events. The same
 * `pairClockEvents` arithmetic `/app/timesheets` shows, so the chart cannot
 * disagree with the screen it reports on) and shifts scheduled. Labour *cost*
 * is in §17's category list and is deliberately absent: no pay-rate column
 * exists anywhere in the schema, so a cost chart would be an invented number
 * presented with the authority of a graph.
 *
 * ## Two charts, never two axes
 *
 * Scheduled shifts and worked hours are different magnitudes on different
 * units. Putting them on one plot needs a second y-scale, which lets the author
 * imply any relationship they like by choosing the scales. The single most
 * common charting mistake. They get one plot each.
 */
export function ReportsAnalyticsCard({
  period,
  rangeLabel,
}: ReportsAnalyticsCardProps): JSX.Element {
  const [hours, setHours] = useState<{ date: string; hours: number }[]>([]);
  const [shifts, setShifts] = useState<{ date: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!period) return;
    let active = true;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const [timesheetRows, shiftRows] = await Promise.all([
          getTimesheetReportRows(period),
          getShiftReportRows(period),
        ]);
        if (!active) return;
        setHours(
          timesheetRows.map((r) => ({ date: r.date, hours: Number(r.hours) || 0 })),
        );
        setShifts(shiftRows.map((r) => ({ date: r.date })));
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
          <div className="h-40 animate-pulse rounded-xl bg-surface-subtle dark:bg-surface-subtle-dark" />
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
    if (hourGroups.length === 0 && shiftGroups.length === 0) {
      return (
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          No clock events or shifts fall in {rangeLabel.toLowerCase()}. Pick a wider
          range, or check the rota has been published.
        </p>
      );
    }
    return (
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
    );
  };

  return (
    <Card className="mb-4 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-card-heading font-semibold text-content dark:text-content-dark">
          <BarChart3 size={16} aria-hidden="true" className="text-primary" />
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
