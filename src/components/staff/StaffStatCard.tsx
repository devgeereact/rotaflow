import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { IconTile, type IconTileTone } from '@/components/ui/IconTile';

interface StaffStatCardProps {
  icon: LucideIcon;
  tone: IconTileTone;
  label: string;
  value: string;
  hint: string;
}

/**
 * One tile in the summary row above the staff table (design/staff.png):
 * tinted icon square on the left, label / value / hint stacked to its right.
 */
export function StaffStatCard({
  icon,
  tone,
  label,
  value,
  hint,
}: StaffStatCardProps): JSX.Element {
  return (
    <Card className="flex items-start gap-3 px-4 py-4">
      <IconTile icon={icon} tone={tone} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-content dark:text-content-dark">
          {label}
        </p>
        <p className="mt-0.5 text-3xl font-bold leading-9 text-content dark:text-content-dark">
          {value}
        </p>
        <p className="mt-1 truncate text-xs text-content-muted dark:text-content-muted-dark">
          {hint}
        </p>
      </div>
    </Card>
  );
}
