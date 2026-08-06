import { CalendarDays, Clock3, Repeat2, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { downloadCsv } from '@/lib/csv';
import {
  getLeaveReportRows,
  getShiftReportRows,
  getSwapReportRows,
  getTimesheetReportRows,
  type ReportPeriod,
} from '@/services/reportsService';
import type { ReportCategory, ReportFormat } from '@/lib/reportRows';

/**
 * The exports `/app/reports` can actually produce, each backed by a real query
 * in `src/services/reportsService.ts`. The design reference lists more report
 * types (labour cost, compliance, overtime, new starters and so on); they are
 * deliberately absent rather than shown greyed out, because there is nothing
 * behind them yet. See design/.loop/reports-log.md.
 */

export interface ReportDefinition {
  id: string;
  name: string;
  category: ReportCategory;
  description: string;
  icon: LucideIcon;
  format: ReportFormat;
  /** Generates the file. Rejects on failure; the page reports it to the user. */
  run: (period: ReportPeriod, fileSuffix: string) => Promise<void>;
}

export const REPORT_CATALOGUE: ReportDefinition[] = [
  {
    id: 'scheduled-rota',
    name: 'Scheduled Rota Report',
    category: 'Scheduling',
    description: 'The published rota for this period, who worked where and when.',
    icon: CalendarDays,
    format: 'CSV',
    run: async (period, suffix) => {
      const rows = await getShiftReportRows(period);
      downloadCsv(`shifts_${suffix}.csv`, rows, [
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
    id: 'timesheet-summary',
    name: 'Timesheet Summary',
    category: 'Timesheets',
    description: 'Hours worked per person, computed from real clock in/out events.',
    icon: Clock3,
    format: 'CSV',
    run: async (period, suffix) => {
      const rows = await getTimesheetReportRows(period);
      downloadCsv(`timesheets_${suffix}.csv`, rows, [
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
    id: 'leave-summary',
    name: 'Leave Summary Report',
    category: 'Leave',
    description: 'Every leave request overlapping this period, with review status.',
    icon: ShieldCheck,
    format: 'CSV',
    run: async (period, suffix) => {
      const rows = await getLeaveReportRows(period);
      downloadCsv(`leave_${suffix}.csv`, rows, [
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
    id: 'swap-activity',
    name: 'Swap Activity Report',
    category: 'Swaps',
    description: 'Swap requests for shifts in this period, with review status.',
    icon: Repeat2,
    format: 'CSV',
    run: async (period, suffix) => {
      const rows = await getSwapReportRows(period);
      downloadCsv(`swaps_${suffix}.csv`, rows, [
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

export type ReportRangeId = 'this-month' | 'last-month' | 'this-week' | 'last-30';

export interface ReportRange {
  id: ReportRangeId;
  label: string;
}

export const REPORT_RANGES: ReportRange[] = [
  { id: 'this-month', label: 'This Month' },
  { id: 'last-month', label: 'Last Month' },
  { id: 'this-week', label: 'This Week' },
  { id: 'last-30', label: 'Last 30 Days' },
];

export interface ResolvedRange {
  /** Inclusive local start of the window. */
  from: Date;
  /** Exclusive local end of the window. */
  to: Date;
}

/** Turns a range id into concrete bounds, anchored on `now` (local midnight). */
export function resolveRange(id: ReportRangeId, now: Date): ResolvedRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  switch (id) {
    case 'last-month': {
      const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const to = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from, to };
    }
    case 'this-week': {
      // Monday-first, matching how the rota and timesheets weeks are framed.
      const from = new Date(today);
      from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
      return { from, to: tomorrow };
    }
    case 'last-30': {
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      return { from, to: tomorrow };
    }
    case 'this-month':
    default:
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: tomorrow };
  }
}

/** Local calendar date, `toISOString()` would shift east-of-UTC midnights back a day. */
function isoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** `2025-05-01_2025-05-31`. The suffix on every generated filename. */
export function rangeFileSuffix({ from, to }: ResolvedRange): string {
  const lastDay = new Date(to);
  lastDay.setDate(lastDay.getDate() - 1);
  return `${isoDate(from)}_${isoDate(lastDay)}`;
}
