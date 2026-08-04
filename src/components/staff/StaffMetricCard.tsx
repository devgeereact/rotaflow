import type { LucideIcon } from 'lucide-react';
import { StatTile } from '@/components/ui/StatTile';
import type { IconTileTone } from '@/components/ui/IconTile';

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
 *
 * A thin wrapper over the shared `StatTile` — this used to hand-roll the
 * identical markup, which is exactly the duplication `StatTile`'s own doc
 * comment names it as one of (`docs/DESIGN.md`, "seven near-identical
 * versions"). Kept as its own component so callers keep this narrower,
 * staff-specific prop contract (icon/hint required) rather than reaching
 * into the generic tile directly.
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
    <StatTile
      icon={icon}
      tone={tone}
      label={label}
      value={value}
      suffix={suffix}
      hint={hint}
    />
  );
}
