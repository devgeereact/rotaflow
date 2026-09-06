import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollRegion } from '@/components/ui/ScrollRegion';
import { AttendanceStatusBadge } from '@/components/attendance/AttendanceStatusBadge';
import { JobTitleBadge } from '@/components/staff/JobTitleBadge';
import type { AttendanceViewRow } from '@/lib/attendanceRows';
import type { SortSpec } from '@/lib/filters';

export interface AttendanceTableProps {
  rows: AttendanceViewRow[];
  sorts: readonly SortSpec<AttendanceViewRow>[];
  sort: string;
  direction: 'asc' | 'desc';
  onSort: (id: string, direction: 'asc' | 'desc') => void;
  onOpen: (row: AttendanceViewRow) => void;
  /** Shown under the header when sites in scope do not share a timezone. */
  mixedTimezoneNote?: string | null;
}

const CELL = 'px-3 py-2.5 align-middle text-sm';
const HEAD =
  'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-content-muted dark:text-content-muted-dark';

function SortButton({
  spec,
  active,
  direction,
  onSort,
}: {
  spec: SortSpec<AttendanceViewRow>;
  active: boolean;
  direction: 'asc' | 'desc';
  onSort: (id: string, direction: 'asc' | 'desc') => void;
}): JSX.Element {
  const Icon = direction === 'desc' ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={() => onSort(spec.id, active && direction === 'asc' ? 'desc' : 'asc')}
      className="inline-flex items-center gap-1 hover:text-content dark:hover:text-content-dark"
    >
      {spec.label}
      {active && <Icon size={12} aria-hidden="true" />}
    </button>
  );
}

/**
 * The attendance record, one row per rostered shift plus one per clock segment
 * that answers to no shift.
 *
 * ## Why the actual column prints a date
 *
 * A night shift's clock-out is on the next calendar day. `06:00` sitting to
 * the right of `22:00` with nothing between them is read as a six-hour gap in
 * the morning, not as an eight-hour night. `attendanceRows` appends the date
 * whenever the two differ, in the **site's** timezone rather than the
 * browser's.
 *
 * ## Why below `lg` this is not a table
 *
 * Twelve columns clipped to three, with the rest reachable only by a
 * horizontal drag, is what the design review found on the Team directory. The
 * same rows render as labelled cards on a phone, carrying the same facts in
 * the same order.
 */
export function AttendanceTable({
  rows,
  sorts,
  sort,
  direction,
  onSort,
  onOpen,
  mixedTimezoneNote,
}: AttendanceTableProps): JSX.Element {
  const sortById = (id: string): SortSpec<AttendanceViewRow> | undefined =>
    sorts.find((spec) => spec.id === id);

  return (
    <div>
      {mixedTimezoneNote && (
        <p className="mb-2 text-xs text-content-muted dark:text-content-muted-dark">
          {mixedTimezoneNote}
        </p>
      )}

      {/* Phones and small tablets: one card per row. */}
      <ul className="space-y-2 lg:hidden">
        {rows.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              onClick={() => onOpen(row)}
              className="w-full rounded-xl border border-surface-border p-3 text-left hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:hover:bg-surface-subtle-dark"
            >
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-content dark:text-content-dark">
                    {row.name}
                  </span>
                  <span className="block truncate text-xs text-content-muted dark:text-content-muted-dark">
                    {[row.jobTitleName, row.locationName].filter(Boolean).join(' · ') ||
                      'No job title'}
                  </span>
                </span>
                <AttendanceStatusBadge status={row.status} className="shrink-0" />
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div>
                  <dt className="text-content-muted dark:text-content-muted-dark">
                    Planned
                  </dt>
                  <dd className="font-mono text-content dark:text-content-dark">
                    {row.plannedLabel}
                  </dd>
                </div>
                <div>
                  <dt className="text-content-muted dark:text-content-muted-dark">
                    Actual
                  </dt>
                  <dd className="font-mono text-content dark:text-content-dark">
                    {row.actualLabel}
                  </dd>
                </div>
                <div>
                  <dt className="text-content-muted dark:text-content-muted-dark">
                    Worked
                  </dt>
                  <dd className="font-mono text-content dark:text-content-dark">
                    {row.workedLabel}
                  </dd>
                </div>
                <div>
                  <dt className="text-content-muted dark:text-content-muted-dark">
                    Variance
                  </dt>
                  <dd className="font-mono text-content dark:text-content-dark">
                    {row.varianceLabel}
                  </dd>
                </div>
              </dl>
              {row.issue && (
                <p className="mt-1.5 text-xs text-warning-ink dark:text-warning-ink-dark">
                  {row.issue}
                </p>
              )}
            </button>
          </li>
        ))}
      </ul>

      <ScrollRegion label="Attendance table" className="hidden lg:block">
        <table className="w-full min-w-[62rem] border-collapse">
          <caption className="sr-only">
            Attendance for the selected period, one row per rostered shift.
          </caption>
          <thead>
            <tr className="border-b border-surface-border dark:border-surface-border-dark">
              <th scope="col" className={HEAD}>
                <SortButton
                  spec={sortById('name')!}
                  active={sort === 'name'}
                  direction={direction}
                  onSort={onSort}
                />
              </th>
              <th scope="col" className={HEAD}>
                Job title
              </th>
              <th scope="col" className={HEAD}>
                Location
              </th>
              <th scope="col" className={HEAD}>
                <SortButton
                  spec={sortById('expected')!}
                  active={sort === 'expected'}
                  direction={direction}
                  onSort={onSort}
                />
              </th>
              <th scope="col" className={HEAD}>
                <SortButton
                  spec={sortById('actual')!}
                  active={sort === 'actual'}
                  direction={direction}
                  onSort={onSort}
                />
              </th>
              <th scope="col" className={HEAD}>
                Break
              </th>
              <th scope="col" className={HEAD}>
                Worked
              </th>
              <th scope="col" className={HEAD}>
                Variance
              </th>
              <th scope="col" className={HEAD}>
                Source
              </th>
              <th scope="col" className={HEAD}>
                <SortButton
                  spec={sortById('severity')!}
                  active={sort === 'severity'}
                  direction={direction}
                  onSort={onSort}
                />
              </th>
              <th scope="col" className={HEAD}>
                <span className="sr-only">Review</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border dark:divide-surface-border-dark">
            {rows.map((row) => (
              <tr
                key={row.key}
                className="hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark"
              >
                <td
                  className={cn(CELL, 'font-medium text-content dark:text-content-dark')}
                >
                  {row.name}
                </td>
                <td className={CELL}>
                  <JobTitleBadge name={row.jobTitleName} colour={row.jobTitleColour} />
                </td>
                <td
                  className={cn(CELL, 'text-content-muted dark:text-content-muted-dark')}
                >
                  {row.locationName ?? 'Unassigned'}
                </td>
                <td className={cn(CELL, 'whitespace-nowrap font-mono')}>
                  {row.plannedLabel}
                </td>
                <td className={cn(CELL, 'whitespace-nowrap font-mono')}>
                  {row.actualLabel}
                </td>
                <td className={cn(CELL, 'font-mono')}>{row.breakLabel}</td>
                <td className={cn(CELL, 'font-mono')}>{row.workedLabel}</td>
                <td className={cn(CELL, 'font-mono')}>{row.varianceLabel}</td>
                <td
                  className={cn(CELL, 'text-content-muted dark:text-content-muted-dark')}
                >
                  {row.source ?? '-'}
                </td>
                <td className={CELL}>
                  <AttendanceStatusBadge status={row.status} />
                </td>
                <td className={cn(CELL, 'text-right')}>
                  <button
                    type="button"
                    onClick={() => onOpen(row)}
                    className="rounded-lg px-2 py-1 text-sm font-medium text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-primary-ink-dark"
                  >
                    Review
                    <span className="sr-only"> {row.name}</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </div>
  );
}
