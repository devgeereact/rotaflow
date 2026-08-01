import { ChevronDown, ListFilter, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AnnouncementFilterOption {
  value: string;
  label: string;
}

export interface AnnouncementFilterSelect {
  id: string;
  /** Shown as the "all" option and as the field's accessible name. */
  allLabel: string;
  value: string;
  options: AnnouncementFilterOption[];
  onChange: (value: string) => void;
  /**
   * Fixed width. A native select otherwise sizes to its widest *option*, which
   * breaks the single-row filter bar apart.
   */
  widthClass?: string;
}

interface AnnouncementFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  selects: AnnouncementFilterSelect[];
  onFilters: () => void;
}

const CONTROL =
  'h-11 rounded-xl border border-surface-border bg-surface text-sm text-content ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
  'dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark';

/**
 * Search + scope selects + the "Filters" escape hatch, sitting between the tab
 * bar and the announcements table (design/Announcements-Dashboard.png).
 */
export function AnnouncementFilterBar({
  search,
  onSearchChange,
  selects,
  onFilters,
}: AnnouncementFilterBarProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative w-68">
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search announcements..."
          aria-label="Search announcements"
          className={cn(
            CONTROL,
            'w-full pl-4 pr-10 placeholder:text-content-muted dark:placeholder:text-content-muted-dark',
          )}
        />
        <Search
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-content-muted dark:text-content-muted-dark"
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
              'appearance-none truncate pl-4 pr-10 text-xs font-semibold',
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
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-content-muted dark:text-content-muted-dark"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={onFilters}
        className={cn(
          CONTROL,
          'ml-auto flex items-center gap-2 px-4 text-xs font-semibold transition-colors hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark',
        )}
      >
        <ListFilter size={18} aria-hidden="true" />
        Filters
      </button>
    </div>
  );
}
