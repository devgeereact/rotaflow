import { ChevronDown, ListFilter, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StaffFilterOption {
  value: string;
  label: string;
}

export interface StaffFilterSelect {
  id: string;
  /** Shown as the "all" option and as the field's accessible name. */
  allLabel: string;
  value: string;
  options: StaffFilterOption[];
  onChange: (value: string) => void;
  /**
   * Fixed width class. A native select otherwise sizes to its widest *option*
   * ("Sunshine Care Home"), which blows the single-row filter bar apart.
   */
  widthClass?: string;
}

interface StaffFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  selects: StaffFilterSelect[];
  /** Omitted on the Invitations tab, which has nothing further to filter by. */
  onMoreFilters?: () => void;
  onAdd?: () => void;
  /** Label on the primary action. Defaults to the directory's "Add Staff". */
  addLabel?: string;
  searchPlaceholder?: string;
  /** Accessible name for the search field; defaults to the placeholder's noun. */
  searchLabel?: string;
}

const CONTROL =
  'h-9 rounded-xl border border-surface-border bg-surface text-sm text-content ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
  'dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark';

/**
 * Search + scope selects + actions, sitting between the summary tiles and the
 * table (design/staff.png). Shared by both tabs of the Staff workspace, so the
 * labels are parameterised; the defaults are the directory's.
 */
export function StaffFilterBar({
  search,
  onSearchChange,
  selects,
  onMoreFilters,
  onAdd,
  addLabel = 'Add Staff',
  searchPlaceholder = 'Search staff...',
  searchLabel = 'Search staff',
}: StaffFilterBarProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative w-60">
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchLabel}
          className={cn(CONTROL, 'w-full pl-3.5 pr-9 placeholder:text-content-muted')}
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
              'appearance-none truncate pl-3.5 pr-9 font-medium',
              select.widthClass ?? 'w-36',
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

      <div className="ml-auto flex items-center gap-3">
        {onMoreFilters && (
          <button
            type="button"
            onClick={onMoreFilters}
            className={cn(
              CONTROL,
              'flex items-center gap-2 px-3.5 font-medium transition-colors hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark',
            )}
          >
            <ListFilter size={16} aria-hidden="true" />
            More Filters
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        )}

        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="flex h-9 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Plus size={16} aria-hidden="true" />
            {addLabel}
          </button>
        )}
      </div>
    </div>
  );
}
