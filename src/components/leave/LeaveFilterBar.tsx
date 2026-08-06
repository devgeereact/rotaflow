import { CalendarDays, ChevronDown, ListFilter } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LeaveFilterOption {
  id: string;
  name: string;
}

export interface LeaveFilterSelect {
  id: string;
  /** The "All …" entry, and the label the control reads when nothing is picked. */
  allLabel: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: LeaveFilterOption[];
}

interface LeaveFilterBarProps {
  /** Pre-formatted period, e.g. "26 May-1 June 2025". */
  periodLabel: string;
  onPeriodClick: () => void;
  selects: LeaveFilterSelect[];
  onFilters: () => void;
}

const CONTROL =
  'flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-surface px-3 text-[0.78rem] font-medium text-content transition-colors hover:bg-surface-subtle ' +
  'focus-within:ring-2 focus-within:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
  'dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark';

const SELECT =
  'w-full appearance-none bg-transparent pr-4 text-[0.78rem] font-medium text-content outline-none dark:text-content-dark';

/**
 * The six scope controls between the tabs and the request table
 * (design/Leave.png): a period picker, four selects and a Filters button.
 */
export function LeaveFilterBar({
  periodLabel,
  onPeriodClick,
  selects,
  onFilters,
}: LeaveFilterBarProps): JSX.Element {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_0.68fr]">
      <button type="button" onClick={onPeriodClick} className={cn(CONTROL, 'relative')}>
        <CalendarDays
          size={16}
          aria-hidden="true"
          className="text-content-muted dark:text-content-muted-dark"
        />
        <span className="truncate">{periodLabel}</span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="ml-auto shrink-0 text-content-muted dark:text-content-muted-dark"
        />
      </button>

      {selects.map((select) => (
        <div key={select.id} className={cn(CONTROL, 'relative')}>
          <select
            value={select.value}
            onChange={(event) => select.onChange(event.target.value)}
            aria-label={select.ariaLabel}
            className={SELECT}
          >
            <option value="">{select.allLabel}</option>
            {select.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute right-3 text-content-muted dark:text-content-muted-dark"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={onFilters}
        className={cn(CONTROL, 'justify-center gap-2')}
      >
        <ListFilter size={16} aria-hidden="true" />
        Filters
      </button>
    </div>
  );
}
