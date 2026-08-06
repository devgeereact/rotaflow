import { ChevronDown, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScheduleView } from '@/lib/schedulePeriod';

const VIEWS: { value: ScheduleView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'fortnight', label: '2 Weeks' },
  { value: 'month', label: 'Month' },
];

export type ScheduleGrouping = 'location' | 'role';

interface ScheduleViewBarProps {
  view: ScheduleView;
  onViewChange: (view: ScheduleView) => void;
  grouping: ScheduleGrouping;
  onGroupingChange: (grouping: ScheduleGrouping) => void;
  onSettings: () => void;
}

const CONTROL =
  'flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-surface px-3 text-sm font-medium text-content transition-colors hover:bg-surface-subtle ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
  'dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark';

/**
 * Period length on the left, grouping and display options on the right. The
 * row sitting between the summary tiles and the grid
 * (design/Schedule-dashboard.png).
 */
export function ScheduleViewBar({
  view,
  onViewChange,
  grouping,
  onGroupingChange,
  onSettings,
}: ScheduleViewBarProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        role="group"
        aria-label="Period length"
        className="flex h-10 items-center gap-1 rounded-xl border border-surface-border bg-surface p-1 dark:border-surface-border-dark dark:bg-surface-dark"
      >
        {VIEWS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onViewChange(option.value)}
            aria-pressed={view === option.value}
            className={cn(
              'h-8 rounded-lg px-4 text-sm font-medium transition-colors',
              view === option.value
                ? 'bg-primary/10 font-semibold text-primary'
                : 'text-content-muted hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className={cn(CONTROL, 'relative pr-8')}>
          <span className="text-content-muted dark:text-content-muted-dark">
            Group by:
          </span>
          <select
            value={grouping}
            onChange={(event) => onGroupingChange(event.target.value as ScheduleGrouping)}
            aria-label="Group staff by"
            className="appearance-none bg-transparent text-sm font-medium text-content outline-none dark:text-content-dark"
          >
            <option value="location">Location</option>
            <option value="role">Role</option>
          </select>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute right-3 text-content-muted dark:text-content-muted-dark"
          />
        </div>

        <button
          type="button"
          onClick={onSettings}
          className={cn(CONTROL, 'px-4')}
          aria-label="Schedule display settings"
        >
          <Settings size={16} aria-hidden="true" />
          Settings
          <ChevronDown
            size={14}
            aria-hidden="true"
            className="text-content-muted dark:text-content-muted-dark"
          />
        </button>
      </div>
    </div>
  );
}
