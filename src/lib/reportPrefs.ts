import type { ReportCategory, ReportFormat } from '@/lib/reportRows';

/**
 * Per-browser reporting preferences: which reports the user starred, and a log
 * of the exports they generated here.
 *
 * Deliberately local. There is no `report_runs` or `saved_reports` table in
 * `docs/SCHEMA.md`, and inventing server-side run history to fill the "Last
 * Run" column would be fabricating data. What this does record is true: it is
 * this browser's own record of exports it produced. Best-effort throughout,
 * a blocked or full localStorage degrades to "never run", never to an error.
 */

export interface ReportRunRecord {
  id: string;
  reportId: string;
  name: string;
  category: ReportCategory;
  /** What the export covered, e.g. "All locations · This Month". */
  scope: string;
  format: ReportFormat;
  /** ISO timestamp of the run. */
  at: string;
  /** False when the export threw. The Overview counts these as failed. */
  ok: boolean;
}

const FAVOURITES_PREFIX = 'rotaflow:report-favourites:';
const RUNS_PREFIX = 'rotaflow:report-runs:';
/** Enough to fill the Recent Reports rail many times over without growing forever. */
const MAX_RUNS = 25;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or quota exhausted. Preferences are a convenience; losing
    // them must never break an export.
  }
}

export function readFavourites(orgId: string): string[] {
  const value = read<unknown>(`${FAVOURITES_PREFIX}${orgId}`, []);
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string')
    : [];
}

export function toggleFavourite(orgId: string, reportId: string): string[] {
  const current = readFavourites(orgId);
  const next = current.includes(reportId)
    ? current.filter((id) => id !== reportId)
    : [...current, reportId];
  write(`${FAVOURITES_PREFIX}${orgId}`, next);
  return next;
}

export function readRuns(orgId: string): ReportRunRecord[] {
  const value = read<unknown>(`${RUNS_PREFIX}${orgId}`, []);
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is ReportRunRecord =>
      typeof row === 'object' &&
      row !== null &&
      typeof (row as ReportRunRecord).at === 'string',
  );
}

export function recordRun(
  orgId: string,
  entry: Omit<ReportRunRecord, 'id' | 'at'>,
): ReportRunRecord[] {
  const at = new Date().toISOString();
  const record: ReportRunRecord = { ...entry, id: `${entry.reportId}-${at}`, at };
  const next = [record, ...readRuns(orgId)].slice(0, MAX_RUNS);
  write(`${RUNS_PREFIX}${orgId}`, next);
  return next;
}

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "Today, 09:15" / "Yesterday, 16:30" / "24 May 2025". The reference's format. */
export function formatRunLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '-';

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  if (at >= startOfToday) return `Today, ${TIME.format(at)}`;
  if (at >= startOfYesterday) return `Yesterday, ${TIME.format(at)}`;
  return DATE.format(at);
}
