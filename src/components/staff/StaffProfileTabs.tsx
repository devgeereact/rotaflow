import { cn } from '@/lib/utils';
import type { StaffProfileTab } from '@/lib/staffProfile';

interface StaffProfileTabsProps {
  active: StaffProfileTab;
  onChange: (tab: StaffProfileTab) => void;
}

const TABS: { value: StaffProfileTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'availability', label: 'Availability' },
  { value: 'shifts', label: 'Shifts' },
  { value: 'leave', label: 'Leave' },
  { value: 'swaps', label: 'Swaps' },
  { value: 'skills', label: 'Skills & Qualifications' },
  { value: 'timesheets', label: 'Timesheets' },
  { value: 'notes', label: 'Notes' },
  { value: 'files', label: 'Files' },
  { value: 'activity', label: 'Activity' },
];

/** Underlined tab strip under the profile header (design/Staff-Profile.png). */
export function StaffProfileTabs({
  active,
  onChange,
}: StaffProfileTabsProps): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Staff profile sections"
      className="flex flex-wrap items-center gap-10 border-b border-surface-border dark:border-surface-border-dark"
    >
      {TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === active}
          onClick={() => onChange(tab.value)}
          className={cn(
            '-mb-px whitespace-nowrap border-b-2 pb-3 text-sm font-semibold transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            tab.value === active
              ? 'border-primary text-primary'
              : 'border-transparent text-content-muted hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
