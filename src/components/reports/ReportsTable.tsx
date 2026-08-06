import { Download, MoreVertical, Play, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReportChip } from '@/components/reports/ReportChip';
import { ReportIcon } from '@/components/reports/ReportIcon';
import {
  REPORT_CATEGORY_TONE,
  REPORT_FORMAT_TONE,
  REPORT_FREQUENCY_TONE,
  type ReportRow,
} from '@/lib/reportRows';

interface ReportsTableProps {
  rows: ReportRow[];
  onToggleFavourite: (id: string) => void;
  onRun: (id: string) => void;
  onDownload: (id: string) => void;
  /** Omitted where no row menu exists to open. */
  onRowMenu?: (id: string) => void;
  /** Set while a report is generating. Its Run button shows the busy state. */
  runningId: string | null;
  emptyMessage: string;
}

const HEAD_CELL =
  'whitespace-nowrap px-2 py-4 text-left text-[0.8rem] font-semibold text-content dark:text-content-dark';

const ACTION =
  'grid h-9 w-9 place-items-center rounded-lg border border-surface-border transition-colors hover:bg-surface-subtle ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-40 ' +
  'dark:border-surface-border-dark dark:hover:bg-surface-subtle-dark';

/** The report catalogue, one row per report (design/Reports-Dashboard.png). */
export function ReportsTable({
  rows,
  onToggleFavourite,
  onRun,
  onDownload,
  onRowMenu,
  runningId,
  emptyMessage,
}: ReportsTableProps): JSX.Element {
  if (rows.length === 0) {
    return (
      <p className="p-6 text-sm text-content-muted dark:text-content-muted-dark">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[58rem] table-fixed border-collapse">
        <thead>
          <tr className="border-b border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
            <th scope="col" className="w-[4.5%] px-2 py-4">
              <span className="sr-only">Favourite</span>
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'w-[19.5%]')}>
              Report Name
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'w-[10.5%]')}>
              Category
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'w-[22%]')}>
              Description
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'w-[12.5%]')}>
              Last Run
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'w-[10%]')}>
              Frequency
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'w-[8%]')}>
              Format
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'w-[13%] text-center')}>
              Actions
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-divider last:border-0 dark:border-divider-dark"
            >
              <td className="px-2 py-3.5">
                <button
                  type="button"
                  onClick={() => onToggleFavourite(row.id)}
                  aria-pressed={row.favourite}
                  aria-label={
                    row.favourite
                      ? `Remove ${row.name} from favourites`
                      : `Add ${row.name} to favourites`
                  }
                  className="grid h-7 w-7 place-items-center rounded-lg transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-surface-subtle-dark"
                >
                  <Star
                    size={18}
                    aria-hidden="true"
                    className={cn(
                      row.favourite
                        ? 'fill-warning text-warning'
                        : 'text-content-muted dark:text-content-muted-dark',
                    )}
                  />
                </button>
              </td>

              <td className="px-2 py-3.5">
                <div className="flex items-center gap-3">
                  <ReportIcon icon={row.icon} tone={REPORT_CATEGORY_TONE[row.category]} />
                  <span className="min-w-0 truncate text-[0.78rem] font-semibold text-content dark:text-content-dark">
                    {row.name}
                  </span>
                </div>
              </td>

              <td className="px-2 py-3.5">
                <ReportChip tone={REPORT_CATEGORY_TONE[row.category]} className="py-1.5">
                  {row.category}
                </ReportChip>
              </td>

              <td className="px-2 py-3.5 text-[0.74rem] font-medium leading-5 text-content-muted dark:text-content-muted-dark">
                {row.description}
              </td>

              <td className="px-2 py-3.5">
                <p className="text-[0.78rem] font-semibold leading-5 text-content dark:text-content-dark">
                  {row.lastRunLabel ?? 'Never run'}
                </p>
                {row.lastRunBy && (
                  <p className="truncate text-[0.72rem] font-medium leading-4 text-content-muted dark:text-content-muted-dark">
                    {row.lastRunBy}
                  </p>
                )}
              </td>

              <td className="px-2 py-3.5">
                <ReportChip tone={REPORT_FREQUENCY_TONE[row.frequency]}>
                  {row.frequency}
                </ReportChip>
              </td>

              <td className="px-2 py-3.5">
                <ReportChip tone={REPORT_FORMAT_TONE[row.format]}>
                  {row.format}
                </ReportChip>
              </td>

              <td className="px-2 py-3.5">
                <div className="flex items-center gap-3.5">
                  <button
                    type="button"
                    onClick={() => onRun(row.id)}
                    disabled={!row.runnable || runningId !== null}
                    aria-busy={runningId === row.id}
                    aria-label={`Run ${row.name}`}
                    title={row.runnable ? `Run ${row.name}` : 'Not available yet'}
                    className={cn(ACTION, 'text-primary')}
                  >
                    <Play
                      size={16}
                      aria-hidden="true"
                      className={cn(runningId === row.id && 'animate-pulse')}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDownload(row.id)}
                    disabled={!row.runnable || runningId !== null}
                    aria-label={`Download ${row.name}`}
                    title={row.runnable ? `Download ${row.name}` : 'Not available yet'}
                    className={cn(ACTION, 'text-content dark:text-content-dark')}
                  >
                    <Download size={16} aria-hidden="true" />
                  </button>
                  {onRowMenu && (
                    <button
                      type="button"
                      onClick={() => onRowMenu(row.id)}
                      aria-label={`More actions for ${row.name}`}
                      className={cn(
                        ACTION,
                        'text-content-muted dark:text-content-muted-dark',
                      )}
                    >
                      <MoreVertical size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
