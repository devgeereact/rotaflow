import { cn } from '@/lib/utils';
import { STATE_DOT } from '@/lib/availabilityMatrix';
import type { AvailabilityState } from '@/lib/availabilityMatrix';

export type AvailabilityRange = 'week' | 'month';

interface AvailabilityViewBarProps {
  range: AvailabilityRange;
  onRangeChange: (range: AvailabilityRange) => void;
  showPreferences: boolean;
  onShowPreferencesChange: (next: boolean) => void;
  legend: { state: AvailabilityState; label: string }[];
}

const RANGES: { value: AvailabilityRange; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

/** Range toggle, the preferences switch, and the matrix colour key. */
export function AvailabilityViewBar({
  range,
  onRangeChange,
  showPreferences,
  onShowPreferencesChange,
  legend,
}: AvailabilityViewBarProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div
        role="tablist"
        aria-label="Matrix range"
        className="inline-flex rounded-xl border border-surface-border bg-surface p-1 dark:border-surface-border-dark dark:bg-surface-dark"
      >
        {RANGES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={range === option.value}
            onClick={() => onRangeChange(option.value)}
            className={cn(
              'h-8 rounded-lg px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              range === option.value
                ? 'bg-primary/10 text-primary dark:bg-primary/15'
                : 'text-content-muted hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-content dark:text-content-dark">
        <input
          type="checkbox"
          checked={showPreferences}
          onChange={(e) => onShowPreferencesChange(e.target.checked)}
          className="h-4 w-4 rounded border-surface-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
        />
        Show preferences
      </label>

      <ul className="ml-auto flex flex-wrap items-center gap-4">
        {legend.map((item) => (
          <li
            key={item.state}
            className="flex items-center gap-1.5 text-xs text-content dark:text-content-dark"
          >
            <span
              aria-hidden="true"
              className={cn('h-2 w-2 rounded-full', STATE_DOT[item.state])}
            />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
