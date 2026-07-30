import { useCallback, useState, type ChangeEvent } from 'react';
import { BarChart3, CalendarDays, Repeat2, Timer, Umbrella } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/useToast';
import {
  getLeaveReportRows,
  getShiftReportRows,
  getSwapReportRows,
  getTimesheetReportRows,
  type ReportPeriod,
} from '@/services/reportsService';
import { downloadCsv } from '@/lib/csv';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

function firstOfMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Exclusive upper bound: midnight at the start of the day AFTER the selected end date. */
function toExclusiveIso(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

interface ReportDef {
  key: string;
  label: string;
  description: string;
  icon: typeof Timer;
  run: (period: ReportPeriod) => Promise<void>;
}

/**
 * `/app/reports` — owner/manager. Date-range CSV exports covering the
 * things a manager actually hands to payroll/HR: hours worked (computed
 * from clock_events via the same `pairClockEvents` math `/app/timesheets`
 * shows — the `timesheets` table itself has no automation populating it,
 * see that page's header), leave taken, the published rota, and shift
 * swaps. Generated entirely client-side — RLS already scopes every query
 * to this org, there is nothing server-side to add for a CSV download.
 */
export function ReportsPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canManageStaff } = usePermissions();
  const { showError, showSuccess } = useToast();

  const [fromDate, setFromDate] = useState(firstOfMonth());
  const [toDate, setToDate] = useState(today());
  const [runningKey, setRunningKey] = useState<string | null>(null);

  const handleExport = useCallback(
    async (report: ReportDef): Promise<void> => {
      if (!orgId) return;
      setRunningKey(report.key);
      try {
        const period: ReportPeriod = {
          orgId,
          fromIso: new Date(`${fromDate}T00:00:00Z`).toISOString(),
          toIso: toExclusiveIso(toDate),
        };
        await report.run(period);
        showSuccess(`${report.label} exported.`);
      } catch (err) {
        reportError(err, { area: `reports:${report.key}` });
        showError(`Could not export ${report.label.toLowerCase()}. Please try again.`);
      } finally {
        setRunningKey(null);
      }
    },
    [orgId, fromDate, toDate, showError, showSuccess],
  );

  const reports: ReportDef[] = [
    {
      key: 'timesheets',
      label: 'Timesheets',
      description: 'Hours worked per person, computed from real clock in/out events.',
      icon: Timer,
      run: async (period) => {
        const rows = await getTimesheetReportRows(period);
        downloadCsv(`timesheets_${fromDate}_${toDate}.csv`, rows, [
          { label: 'Staff', value: (r) => r.staffName },
          { label: 'Date', value: (r) => r.date },
          { label: 'Clock in', value: (r) => r.clockIn },
          { label: 'Clock out', value: (r) => r.clockOut },
          { label: 'Break (min)', value: (r) => r.breakMinutes },
          { label: 'Hours', value: (r) => r.hours },
        ]);
      },
    },
    {
      key: 'leave',
      label: 'Leave',
      description: 'Every leave request overlapping this period, with review status.',
      icon: Umbrella,
      run: async (period) => {
        const rows = await getLeaveReportRows(period);
        downloadCsv(`leave_${fromDate}_${toDate}.csv`, rows, [
          { label: 'Staff', value: (r) => r.staffName },
          { label: 'Type', value: (r) => r.type },
          { label: 'Start date', value: (r) => r.startDate },
          { label: 'End date', value: (r) => r.endDate },
          { label: 'Status', value: (r) => r.status },
          { label: 'Reviewed by', value: (r) => r.reviewedBy },
          { label: 'Reviewed at', value: (r) => r.reviewedAt },
        ]);
      },
    },
    {
      key: 'shifts',
      label: 'Shifts',
      description: 'The published rota for this period — who worked where and when.',
      icon: CalendarDays,
      run: async (period) => {
        const rows = await getShiftReportRows(period);
        downloadCsv(`shifts_${fromDate}_${toDate}.csv`, rows, [
          { label: 'Staff', value: (r) => r.staffName },
          { label: 'Date', value: (r) => r.date },
          { label: 'Start', value: (r) => r.start },
          { label: 'End', value: (r) => r.end },
          { label: 'Location', value: (r) => r.location },
          { label: 'Department', value: (r) => r.department },
          { label: 'Shift type', value: (r) => r.shiftType },
          { label: 'Status', value: (r) => r.status },
        ]);
      },
    },
    {
      key: 'swaps',
      label: 'Shift swaps',
      description: 'Swap requests for shifts in this period, with review status.',
      icon: Repeat2,
      run: async (period) => {
        const rows = await getSwapReportRows(period);
        downloadCsv(`swaps_${fromDate}_${toDate}.csv`, rows, [
          { label: 'Requested by', value: (r) => r.requestedBy },
          { label: 'Target', value: (r) => r.target },
          { label: 'Shift date', value: (r) => r.shiftDate },
          { label: 'Status', value: (r) => r.status },
          { label: 'Reviewed by', value: (r) => r.reviewedBy },
          { label: 'Reviewed at', value: (r) => r.reviewedAt },
        ]);
      },
    },
  ];

  if (!canManageStaff) {
    return (
      <Card>
        <p className="text-content-muted dark:text-content-muted-dark">
          Only owners and managers can export reports.
        </p>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 flex items-center gap-2 font-display text-2xl text-content dark:text-content-dark">
        <BarChart3 size={22} aria-hidden="true" />
        Reports
      </h1>

      <Card className="mb-6">
        <h2 className="mb-4 font-medium text-content dark:text-content-dark">Period</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="report-from">From</Label>
            <Input
              id="report-from"
              type="date"
              value={fromDate}
              max={toDate}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setFromDate(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="report-to">To</Label>
            <Input
              id="report-to"
              type="date"
              value={toDate}
              min={fromDate}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setToDate(e.target.value)}
            />
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {reports.map((report) => (
          <Card key={report.key} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <report.icon size={18} aria-hidden="true" />
              </span>
              <div>
                <p className="font-medium text-content dark:text-content-dark">
                  {report.label}
                </p>
                <p className="text-sm text-content-muted dark:text-content-muted-dark">
                  {report.description}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void handleExport(report)}
              disabled={runningKey !== null}
            >
              {runningKey === report.key ? 'Exporting…' : 'Export CSV'}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
