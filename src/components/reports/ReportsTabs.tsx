import { cn } from '@/lib/utils';

export type ReportsTab = 'all' | 'favourites' | 'scheduled' | 'custom';

export interface ReportsTabDef {
  value: ReportsTab;
  label: string;
  /** Rendered as a pill after the label; omitted when there is nothing to flag. */
  count?: number;
}

interface ReportsTabsProps {
  tabs: ReportsTabDef[];
  active: ReportsTab;
  onChange: (tab: ReportsTab) => void;
}

/** Underlined tab bar above the reports table (design/Reports-Dashboard.png). */
export function ReportsTabs({ tabs, active, onChange }: ReportsTabsProps): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Report groups"
      className="flex flex-wrap items-center gap-1 border-b border-surface-border dark:border-surface-border-dark"
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
              '-mb-px flex items-center gap-2 border-b-2 px-4 pb-7 pt-4 text-[0.9rem] transition-colors',
              isActive
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent font-semibold text-content hover:text-primary dark:text-content-dark dark:hover:text-primary',
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
