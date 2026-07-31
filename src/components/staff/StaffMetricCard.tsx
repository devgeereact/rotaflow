import type { LucideIcon } from 'lucide-react';
import { IconTile, type IconTileTone } from '@/components/ui/IconTile';

interface StaffMetricCardProps {
  icon: LucideIcon;
  tone: IconTileTone;
  label: string;
  value: string;
  /** Small trailing unit rendered next to the value, e.g. `/ 5`. */
  suffix?: string;
  hint: string;
}

/**
 * One of the five metric tiles above the profile overview
 * (design/Staff-Profile.png): icon and label on the first line, the figure
 * beneath, then a caption.
 */
export function StaffMetricCard({
  icon,
  tone,
  label,
  value,
  suffix,
  hint,
}: StaffMetricCardProps): JSX.Element {
  return (
    <div className="rounded-xl border border-surface-border bg-surface px-3.5 py-3.5 dark:border-surface-border-dark dark:bg-surface-dark">
      <div className="flex items-start gap-2.5">
        <IconTile icon={icon} tone={tone} size="sm" />
        <p className="text-sm font-semibold leading-5 text-content dark:text-content-dark">
          {label}
        </p>
      </div>
      <p className="mt-3 flex items-baseline gap-1.5 text-3xl font-bold leading-9 text-content dark:text-content-dark">
        {value}
        {suffix && (
          <span className="text-sm font-medium text-content-muted dark:text-content-muted-dark">
            {suffix}
          </span>
        )}
      </p>
      <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
        {hint}
      </p>
    </div>
  );
}
