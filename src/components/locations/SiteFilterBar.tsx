import { ChevronDown, ListFilter, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SiteFilterOption {
  value: string;
  label: string;
}

export interface SiteFilterSelect {
  id: string;
  /** Shown as the "all" option and as the field's accessible name. */
  allLabel: string;
  value: string;
  options: SiteFilterOption[];
  onChange: (value: string) => void;
  /**
   * Fixed width class. A native select otherwise sizes to its widest *option*
   * ("Sunnyvale Care Home"), which blows the single-row filter bar apart.
   */
  widthClass?: string;
}

interface SiteFilterBarProps {
  search: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  selects: SiteFilterSelect[];
  onMoreFilters: () => void;
}

const CONTROL =
  'h-9 rounded-xl border border-surface-border bg-surface text-sm text-content ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
  'dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark';

/**
 * Search + scope selects + "Filters", sitting between the summary tiles and
 * the table on both locations references.
 *
 * The search field carries a magnifier at *both* ends, that is what the
 * references draw, on the Locations and the Departments screen alike.
 */
export function SiteFilterBar({
  search,
  searchPlaceholder,
  onSearchChange,
  selects,
  onMoreFilters,
}: SiteFilterBarProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative w-72">
        <Search
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-content-muted dark:text-content-muted-dark"
        />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className={cn(CONTROL, 'w-full pl-10 pr-9 placeholder:text-content-muted')}
        />
        <Search
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-content-muted dark:text-content-muted-dark"
        />
      </div>

      {selects.map((select) => (
        <div key={select.id} className="relative">
          <select
            value={select.value}
            aria-label={select.allLabel}
            onChange={(event) => select.onChange(event.target.value)}
            className={cn(
              CONTROL,
              'appearance-none truncate pl-3.5 pr-9 font-semibold',
              select.widthClass ?? 'w-40',
            )}
          >
            <option value="">{select.allLabel}</option>
            {select.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-content-muted dark:text-content-muted-dark"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={onMoreFilters}
        className={cn(
          CONTROL,
          'ml-auto flex items-center gap-2 px-4 font-semibold transition-colors hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark',
        )}
      >
        <ListFilter size={16} aria-hidden="true" />
        Filters
      </button>
    </div>
  );
}
