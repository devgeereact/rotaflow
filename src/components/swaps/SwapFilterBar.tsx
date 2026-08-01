import { CalendarDays, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SwapFilterOption {
  id: string;
  name: string;
}

export interface SwapFilterSelect {
  id: string;
  /** The "All …" entry shown when nothing is picked. */
  allLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: SwapFilterOption[];
}

interface SwapFilterBarProps {
  /** Pre-formatted period, e.g. "26 May – 1 June 2025". */
  periodLabel: string;
  onPeriodClick: () => void;
  selects: SwapFilterSelect[];
  onMoreFilters: () => void;
}

const CONTROL =
  'flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-surface px-3.5 text-[0.78rem] font-semibold text-content transition-colors hover:bg-surface-subtle ' +
  'focus-within:ring-2 focus-within:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
  'dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark';

const SELECT =
  'w-full appearance-none bg-transparent pr-4 text-[0.78rem] font-semibold text-content outline-none dark:text-content-dark';

/** The six scope controls between the tabs and the table (design/Swap-Request.png). */
export function SwapFilterBar({
  periodLabel,
  onPeriodClick,
  selects,
  onMoreFilters,
}: SwapFilterBarProps): JSX.Element {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[1.76fr_1.12fr_1.22fr_1.15fr_1.1fr_1fr]">
      <button type="button" onClick={onPeriodClick} className={CONTROL}>
        <CalendarDays
          size={16}
          aria-hidden="true"
          className="shrink-0 text-content-muted dark:text-content-muted-dark"
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
            aria-label={select.allLabel}
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
            className="pointer-events-none absolute right-3.5 text-content-muted dark:text-content-muted-dark"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={onMoreFilters}
        className={cn(CONTROL, 'justify-center')}
      >
        <SlidersHorizontal
          size={16}
          aria-hidden="true"
          className="text-content-muted dark:text-content-muted-dark"
        />
        Filters
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="ml-auto shrink-0 text-content-muted dark:text-content-muted-dark"
        />
      </button>
    </div>
  );
}
