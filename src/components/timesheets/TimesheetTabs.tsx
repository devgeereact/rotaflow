import { cn } from '@/lib/utils';

export type TimesheetTab = 'all' | 'pending' | 'approved' | 'submitted' | 'rejected';

export interface TimesheetTabDef {
  value: TimesheetTab;
  label: string;
  /** Rendered as a pill after the label; omitted when there is nothing to flag. */
  count?: number;
}

interface TimesheetTabsProps {
  tabs: TimesheetTabDef[];
  active: TimesheetTab;
  onChange: (tab: TimesheetTab) => void;
}

/** Underlined tab bar above the timesheet table (design/Timesheets-Dashboard.png). */
export function TimesheetTabs({
  tabs,
  active,
  onChange,
}: TimesheetTabsProps): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Timesheet status"
      className="flex flex-wrap items-center gap-2 border-b border-surface-border pb-2.5 dark:border-surface-border-dark"
    >
      {tabs.map((tab) => {
        const isActive = tab.value === active;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            className={cn(
              'flex items-center gap-2 border-b-[3px] px-3.5 pb-2.5 pt-4 text-[0.79rem] transition-colors',
              isActive
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent font-medium text-content-muted hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[0.7rem] font-semibold',
                  isActive ? 'bg-primary text-primary-fg' : 'bg-primary/10 text-primary',
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
