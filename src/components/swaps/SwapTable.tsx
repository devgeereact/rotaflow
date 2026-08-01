import { ArrowRight, ArrowUpDown, ChevronDown, MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SwapParties } from '@/components/swaps/SwapParties';
import { SwapShiftSide } from '@/components/swaps/SwapShiftSide';
import { SWAP_STATUS_LABEL, SWAP_STATUS_TONE } from '@/lib/swapRows';
import type { SwapRow } from '@/lib/swapRows';

interface SwapTableProps {
  rows: SwapRow[];
  /** "Review"/"View" — opens the request. */
  onOpenRow: (id: string) => void;
  onRowMenu: (id: string) => void;
  onSortByRequested: () => void;
  emptyMessage: string;
}

const HEAD_CELL =
  'whitespace-nowrap px-3.5 py-2.5 text-[0.7rem] font-semibold text-content dark:text-content-dark';

/** One row per swap request (design/Swap-Request.png). */
export function SwapTable({
  rows,
  onOpenRow,
  onRowMenu,
  onSortByRequested,
  emptyMessage,
}: SwapTableProps): JSX.Element {
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
          <tr className="border-b border-surface-border dark:border-surface-border-dark">
            <th scope="col" className={cn(HEAD_CELL, 'w-[32%] text-left')}>
              Request
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'w-[31%] text-left')}>
              Shifts
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'w-[12.5%] text-left')}>
              <button
                type="button"
                onClick={onSortByRequested}
                className="inline-flex items-center gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Requested
                <ArrowUpDown
                  size={13}
                  aria-hidden="true"
                  className="text-content-muted dark:text-content-muted-dark"
                />
              </button>
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'w-[11.5%] text-center')}>
              Status
            </th>
            <th scope="col" className={cn(HEAD_CELL, 'w-[13%] text-right')}>
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
              <td className="px-3.5 py-2 align-middle">
                <SwapParties from={row.from} to={row.to} />
              </td>

              <td className="border-x border-divider px-4 py-2 align-middle dark:border-divider-dark">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                  <SwapShiftSide side="giving" shift={row.shift} />
                  <ArrowRight
                    size={15}
                    aria-hidden="true"
                    className="text-content-muted dark:text-content-muted-dark"
                  />
                  <SwapShiftSide side="taking" shift={row.shift} />
                </div>
              </td>

              <td className="px-2.5 py-2 align-middle">
                <p className="truncate text-[0.7rem] leading-4 text-content dark:text-content-dark">
                  {row.requestedLabel}
                </p>
                <p className="truncate text-[0.68rem] leading-4 text-content-muted dark:text-content-muted-dark">
                  {row.requestedByName}
                </p>
              </td>

              <td className="px-1 py-2 text-center align-middle">
                <span
                  className={cn(
                    'inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[0.66rem] font-semibold leading-4',
                    SWAP_STATUS_TONE[row.status],
                  )}
                >
                  {SWAP_STATUS_LABEL[row.status]}
                </span>
                {row.statusNote && (
                  <p className="mt-1 truncate text-[0.62rem] leading-4 text-content-muted dark:text-content-muted-dark">
                    {row.statusNote}
                  </p>
                )}
              </td>

              <td className="px-2 py-2 align-middle">
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenRow(row.id)}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-surface-border px-2 text-[0.7rem] font-semibold text-content transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                  >
                    {row.needsReview ? 'Review' : 'View'}
                    <ChevronDown
                      size={13}
                      aria-hidden="true"
                      className="text-content-muted dark:text-content-muted-dark"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRowMenu(row.id)}
                    aria-label={`More actions for ${row.from.firstName} ${row.from.lastName}'s swap`}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-surface-border text-content-muted transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark"
                  >
                    <MoreVertical size={14} aria-hidden="true" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
