import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { reportsTabId } from '@/lib/reportRows';

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
  /** `id` of the element these tabs switch, which must carry `role="tabpanel"`. */
  panelId: string;
}

/**
 * Underlined tab bar above the reports table (docs/design/Reports-Dashboard.png).
 *
 * A genuine `role="tablist"`. Unlike `ui/Tabs`, which navigates to a URL per
 * section, these swap the rows inside one page, which is what the ARIA tabs
 * pattern is actually for. So the pattern is implemented in full: roving
 * `tabIndex` (the bar is one Tab stop), arrow/Home/End handling, and
 * `aria-controls` pointing at the panel. Declaring the roles without those
 * would promise assistive tech an interaction model that is not there.
 */
export function ReportsTabs({
  tabs,
  active,
  onChange,
  panelId,
}: ReportsTabsProps): JSX.Element {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectAt = (index: number): void => {
    const wrapped = (index + tabs.length) % tabs.length;
    const tab = tabs[wrapped];
    if (!tab) return;
    onChange(tab.value);
    refs.current[wrapped]?.focus();
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        selectAt(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        selectAt(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        selectAt(0);
        break;
      case 'End':
        event.preventDefault();
        selectAt(tabs.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Report groups"
      className="flex flex-wrap items-center gap-1 border-b border-surface-border dark:border-surface-border-dark"
    >
      {tabs.map((tab, index) => {
        const isActive = tab.value === active;
        return (
          <button
            key={tab.value}
            id={reportsTabId(tab.value)}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={panelId}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-4 pb-7 pt-4 text-[0.9rem] transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
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
