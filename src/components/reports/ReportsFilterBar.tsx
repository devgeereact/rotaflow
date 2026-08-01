import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ReportFilterOption {
  value: string;
  label: string;
}

interface ReportsFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  categories: ReportFilterOption[];
  category: string;
  onCategoryChange: (value: string) => void;
  /** Omitted where the catalogue is not scoped by location. */
  locations?: ReportFilterOption[];
  location?: string;
  onLocationChange?: (value: string) => void;
  formats: ReportFilterOption[];
  format: string;
  onFormatChange: (value: string) => void;
  favouritesOnly: boolean;
  onFavouritesOnlyChange: (value: boolean) => void;
}

const CONTROL =
  'flex h-11 items-center gap-2 rounded-xl border border-surface-border bg-surface px-3.5 text-sm font-semibold text-content transition-colors ' +
  'focus-within:ring-2 focus-within:ring-primary ' +
  'dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark';

const SELECT =
  'w-full appearance-none bg-transparent pr-5 text-sm font-semibold text-content outline-none dark:text-content-dark';

/** Scope controls between the tabs and the report table. */
export function ReportsFilterBar({
  search,
  onSearchChange,
  categories,
  category,
  onCategoryChange,
  locations,
  location,
  onLocationChange,
  formats,
  format,
  onFormatChange,
  favouritesOnly,
  onFavouritesOnlyChange,
}: ReportsFilterBarProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className={cn(CONTROL, 'w-full sm:w-64')}>
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search reports..."
          aria-label="Search reports"
          className="min-w-0 flex-1 bg-transparent font-medium text-content outline-none placeholder:text-content-muted dark:text-content-dark dark:placeholder:text-content-muted-dark"
        />
        <Search
          size={16}
          aria-hidden="true"
          className="shrink-0 text-content-muted dark:text-content-muted-dark"
        />
      </div>

      <div className={cn(CONTROL, 'relative w-full sm:w-44')}>
        <select
          value={category}
          onChange={(event) => onCategoryChange(event.target.value)}
          aria-label="Filter by category"
          className={SELECT}
        >
          <option value="">All Categories</option>
          {categories.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute right-3 text-content-muted dark:text-content-muted-dark"
        />
      </div>

      {locations && onLocationChange && (
        <div className={cn(CONTROL, 'relative w-full sm:w-44')}>
          <select
            value={location ?? ''}
            onChange={(event) => onLocationChange(event.target.value)}
            aria-label="Filter by location"
            className={SELECT}
          >
            <option value="">All Locations</option>
            {locations.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute right-3 text-content-muted dark:text-content-muted-dark"
          />
        </div>
      )}

      <div className={cn(CONTROL, 'relative w-full sm:w-40')}>
        <select
          value={format}
          onChange={(event) => onFormatChange(event.target.value)}
          aria-label="Filter by format"
          className={SELECT}
        >
          <option value="">All Formats</option>
          {formats.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute right-3 text-content-muted dark:text-content-muted-dark"
        />
      </div>

      <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-content dark:text-content-dark">
        <input
          type="checkbox"
          checked={favouritesOnly}
          onChange={(event) => onFavouritesOnlyChange(event.target.checked)}
          className="h-4 w-4 rounded border-surface-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
        />
        Favourites only
      </label>
    </div>
  );
}
