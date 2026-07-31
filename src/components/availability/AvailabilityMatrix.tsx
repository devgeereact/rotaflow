import { Clock } from 'lucide-react';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { cn } from '@/lib/utils';
import { STATE_CELL, STATE_LABEL } from '@/lib/availabilityMatrix';
import type {
  AvailabilityCellData,
  AvailabilityDay,
  AvailabilityRowData,
} from '@/lib/availabilityMatrix';

interface AvailabilityMatrixProps {
  days: AvailabilityDay[];
  rows: AvailabilityRowData[];
  /** Hides the time range, leaving only the state label. */
  showPreferences: boolean;
  onSelectCell?: (rowId: string, dayIndex: number) => void;
  emptyMessage: string;
}

function MatrixCell({
  cell,
  showPreferences,
  onSelect,
  label,
}: {
  cell: AvailabilityCellData;
  showPreferences: boolean;
  onSelect?: () => void;
  label: string;
}): JSX.Element {
  return (
    <td className="px-1.5 py-1.5 align-middle">
      <button
        type="button"
        onClick={onSelect}
        aria-label={label}
        className={cn(
          'flex h-[3.25rem] w-full flex-col items-center justify-center rounded-lg px-1 text-center transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          STATE_CELL[cell.state],
        )}
      >
        {cell.timeRange && showPreferences && (
          <span className="text-xs font-medium leading-4">{cell.timeRange}</span>
        )}
        <span className="text-xs leading-4">{STATE_LABEL[cell.state]}</span>
      </button>
    </td>
  );
}

/**
 * The weekly staff × day availability grid (design/Availability.png): one row
 * per person, one column per day, each cell tinted by state. Day headings carry
 * the coverage count for that day, and weekend columns are tinted so a gap at
 * the weekend is visible before you read the numbers.
 */
export function AvailabilityMatrix({
  days,
  rows,
  showPreferences,
  onSelectCell,
  emptyMessage,
}: AvailabilityMatrixProps): JSX.Element {
  if (rows.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[60rem] border-collapse">
        <thead>
          <tr className="border-b border-surface-border dark:border-surface-border-dark">
            <th
              scope="col"
              className="w-52 px-5 py-3 text-left text-sm font-semibold text-content dark:text-content-dark"
            >
              Staff
            </th>
            <th
              scope="col"
              className="w-36 px-2 py-3 text-left text-sm font-semibold text-content dark:text-content-dark"
            >
              Role
            </th>
            {days.map((day) => (
              <th
                key={day.label}
                scope="col"
                className="border-l border-divider px-1.5 py-3 text-center dark:border-divider-dark"
              >
                <span
                  className={cn(
                    'block text-sm font-semibold',
                    day.weekend ? 'text-danger' : 'text-content dark:text-content-dark',
                  )}
                >
                  {day.label}
                </span>
                <span className="mt-1 flex items-center justify-center gap-1 text-xs text-content-muted dark:text-content-muted-dark">
                  <Clock size={12} aria-hidden="true" />
                  {day.covered} / {day.total}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-divider last:border-0 dark:border-divider-dark"
            >
              <td className="px-5 py-2">
                <div className="flex items-center gap-2.5">
                  <StaffAvatar
                    firstName={row.firstName}
                    lastName={row.lastName}
                    photoUrl={row.photoUrl}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-content dark:text-content-dark">
                      {row.firstName} {row.lastName}
                    </p>
                    <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                      {row.payrollId}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-2 py-2">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-content dark:text-content-dark">
                    {row.role}
                  </span>
                  <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary dark:bg-primary/15">
                    {row.roleCode}
                  </span>
                </div>
              </td>
              {row.cells.map((cell, index) => (
                <MatrixCell
                  key={days[index]?.label ?? index}
                  cell={cell}
                  showPreferences={showPreferences}
                  onSelect={onSelectCell ? () => onSelectCell(row.id, index) : undefined}
                  label={`${row.firstName} ${row.lastName}, ${days[index]?.label ?? ''}: ${STATE_LABEL[cell.state]}${cell.timeRange ? ` ${cell.timeRange}` : ''}`}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
