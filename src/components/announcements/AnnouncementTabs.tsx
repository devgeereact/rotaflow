import { cn } from '@/lib/utils';
import type { AnnouncementTab } from '@/lib/announcements';

export interface AnnouncementTabDef {
  value: AnnouncementTab;
  label: string;
}

interface AnnouncementTabsProps {
  tabs: AnnouncementTabDef[];
  active: AnnouncementTab;
  onChange: (tab: AnnouncementTab) => void;
}

/**
 * Underlined tab bar above the announcements table
 * (design/Announcements-Dashboard.png). Only the active tab carries a rule,
 * the reference draws no full-width divider beneath the row.
 */
export function AnnouncementTabs({
  tabs,
  active,
  onChange,
}: AnnouncementTabsProps): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Announcement status"
      className="flex flex-wrap items-center gap-2"
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
              'border-b-2 px-4 pb-3.5 pt-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              isActive
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent font-medium text-content-muted hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
