import { cn } from '@/lib/utils';

export type LeaveTab = 'all' | 'pending' | 'approved' | 'declined' | 'cancelled';

export interface LeaveTabDef {
  value: LeaveTab;
  label: string;
  /** Rendered as a filled badge after the label; omitted when there is nothing to flag. */
  count?: number;
}

interface LeaveTabsProps {
  tabs: LeaveTabDef[];
  active: LeaveTab;
  onChange: (tab: LeaveTab) => void;
}

/**
 * Underlined tab bar above the request table (design/Leave.png).
 *
 * The count badge is `danger`, not `primary`: the reference draws it red on
 * every tab including the inactive one, because it is a queue depth that needs
 * clearing, not a selection indicator.
 */
export function LeaveTabs({ tabs, active, onChange }: LeaveTabsProps): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Leave request status"
      className="flex flex-wrap items-center gap-2 border-b border-surface-border dark:border-surface-border-dark"
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
              '-mb-px flex items-center gap-2 border-b-2 px-5 pb-4 text-[0.88rem] transition-colors',
              isActive
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent font-medium text-content-muted hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1.5 text-[0.68rem] font-semibold text-primary-fg">
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
