import { PanelTabs, type PanelTabItem } from '@/components/ui/PanelTabs';
import type { StaffProfileTab } from '@/lib/staffProfile';

interface StaffProfileTabsProps {
  active: StaffProfileTab;
  onChange: (tab: StaffProfileTab) => void;
}

const TABS: PanelTabItem<StaffProfileTab>[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'shifts', label: 'Shifts' },
  { value: 'documents', label: 'Documents' },
  { value: 'leave', label: 'Leave' },
  { value: 'activity', label: 'Activity' },
];

/** Underlined tab strip under the profile header (design/Staff-Profile.png). */
export function StaffProfileTabs({
  active,
  onChange,
}: StaffProfileTabsProps): JSX.Element {
  return (
    <PanelTabs
      items={TABS}
      active={active}
      onChange={onChange}
      label="Staff profile sections"
    />
  );
}
