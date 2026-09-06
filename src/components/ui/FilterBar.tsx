import { Search, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import {
  activeFilterCount,
  filterChips,
  filterValue,
  filterValues,
  type FilterDimension,
  type FilterOption,
  type FilterState,
} from '@/lib/filters';

export interface FilterBarProps {
  dimensions: readonly FilterDimension[];
  filters: FilterState;
  optionsFor: (dimensionId: string) => readonly FilterOption[];
  onSetValue: (dimensionId: string, value: string) => void;
  onSetValues: (dimensionId: string, values: readonly string[]) => void;
  onClearOne: (dimensionId: string, value?: string) => void;
  onClearAll: () => void;
  /** Id of the free-text dimension, rendered as the search box. */
  searchDimensionId?: string;
  searchPlaceholder?: string;
  /** "21-40 of 137". Announced, because the count is the only feedback a filter gives. */
  resultSummary: string;
  /** Extra controls — a date range, a view switch — placed before the selects. */
  leading?: ReactNode;
  /**
   * Dimensions whose values were dropped by a scope change, so the bar can say
   * why the results widened instead of leaving it as a mystery.
   */
  droppedDimensions?: string[];
  onDismissDropped?: () => void;
}

const SELECT_CLASS =
  'h-11 rounded-xl border border-surface-border bg-surface px-3 text-sm text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark';

/**
 * One toolbar for every filterable table.
 *
 * ## Why it is shared
 *
 * Each screen had grown its own row of selects, and they had drifted: some had
 * a clear-all and some did not, only one announced its result count, none
 * showed which filters were applied once the controls scrolled out of view,
 * and every one of them decided separately whether an empty select meant "all"
 * or "none". A person cannot learn a control that behaves differently on each
 * screen.
 *
 * ## The three things it always does
 *
 * 1. **Says what is applied**, as removable chips, so the state is legible
 *    even when the selects are behind a disclosure on a phone.
 * 2. **Says how many rows matched**, in a live region. A filter's only
 *    feedback is the count; if it is not announced, a keyboard or screen
 *    reader user gets none.
 * 3. **Explains a value that disappeared.** Changing site can invalidate a
 *    department; the results widening with no explanation reads as a bug.
 */
export function FilterBar({
  dimensions,
  filters,
  optionsFor,
  onSetValue,
  onSetValues,
  onClearOne,
  onClearAll,
  searchDimensionId = 'q',
  searchPlaceholder = 'Search',
  resultSummary,
  leading,
  droppedDimensions = [],
  onDismissDropped,
}: FilterBarProps): JSX.Element {
  const applied = activeFilterCount(filters, dimensions);
  const chips = filterChips(filters, dimensions, optionsFor);
  const selectable = dimensions.filter(
    (dimension) => dimension.id !== searchDimensionId && dimension.kind !== 'text',
  );

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {leading}

        <Input
          icon={Search}
          type="search"
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          value={filterValue(filters, searchDimensionId)}
          onChange={(event) => onSetValue(searchDimensionId, event.target.value)}
          wrapperClassName="min-w-[12rem] flex-1 sm:max-w-xs"
        />

        {selectable.map((dimension) => {
          const options = optionsFor(dimension.id);
          const selected = filterValues(filters, dimension.id);
          // A `multi` dimension is still rendered as a single select where it
          // has only a handful of options: a native multiple-select is close
          // to unusable on a phone. Choosing one value replaces the set;
          // chips remain the way to see and remove several.
          return (
            <label key={dimension.id} className="contents">
              <span className="sr-only">{dimension.label}</span>
              <select
                className={SELECT_CLASS}
                aria-label={dimension.label}
                value={selected[0] ?? ''}
                onChange={(event) =>
                  onSetValues(
                    dimension.id,
                    event.target.value === '' ? [] : [event.target.value],
                  )
                }
              >
                <option value="">{dimension.label}: all</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          );
        })}

        {applied > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="h-11 rounded-xl px-3 text-sm font-medium text-primary-ink hover:underline dark:text-primary-ink-dark"
          >
            Clear filters ({applied})
          </button>
        )}

        <p
          aria-live="polite"
          className="ml-auto text-sm text-content-muted dark:text-content-muted-dark"
        >
          {resultSummary}
        </p>
      </div>

      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <li key={`${chip.dimensionId}:${chip.value}`}>
              <button
                type="button"
                onClick={() => onClearOne(chip.dimensionId, chip.value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-subtle px-2.5 py-1 text-xs font-medium text-content',
                  'hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  'dark:border-surface-border-dark dark:bg-surface-subtle-dark dark:text-content-dark',
                )}
              >
                <span className="text-content-muted dark:text-content-muted-dark">
                  {chip.dimensionLabel}:
                </span>
                {chip.label}
                <X size={12} aria-hidden="true" />
                <span className="sr-only">Remove this filter</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {droppedDimensions.length > 0 && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl bg-info-wash px-3 py-2 text-sm text-info-ink dark:bg-info-wash-dark dark:text-info-ink-dark"
        >
          <span className="flex-1">
            {droppedDimensions
              .map(
                (id) => dimensions.find((dimension) => dimension.id === id)?.label ?? id,
              )
              .join(' and ')}{' '}
            no longer applies here, so it was cleared. This can happen when a department
            belongs to a different site, or after switching organisation.
          </span>
          {onDismissDropped && (
            <button
              type="button"
              onClick={onDismissDropped}
              className="shrink-0 font-medium underline"
            >
              Dismiss
            </button>
          )}
        </p>
      )}
    </div>
  );
}
