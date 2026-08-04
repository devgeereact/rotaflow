import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconTile, type IconTileTone } from '@/components/ui/IconTile';
import { cn } from '@/lib/utils';

export interface StatTileProps {
  /** Omit for a figure-only tile — the platform console's default. */
  icon?: LucideIcon;
  tone?: IconTileTone;
  label: string;
  value: ReactNode;
  /** Small trailing unit next to the figure, e.g. `/ 5`. */
  suffix?: string;
  hint?: ReactNode;
  className?: string;
}

/**
 * The metric tile that sits above a dense list screen.
 *
 * ## Why this exists
 *
 * Seven near-identical versions of this component had grown across the app —
 * `dashboard/StatCard`, `staff/StaffStatCard`, `staff/StaffMetricCard`,
 * `timesheets/TimesheetStatCard`, `schedule/ScheduleStatCard`,
 * `availability/AvailabilityStatCard`, `locations/SiteStatCard` — plus
 * `AdminStat` in the platform console. `AvailabilityStatCard` already
 * documented the duplication in a comment ("worth folding into a shared
 * `StatTile` once both have settled"). They have settled, and the platform
 * console would otherwise have made it eight.
 *
 * The split between them was `tint: string` (raw Tailwind classes passed in)
 * versus `tone: IconTileTone` (a token from the palette). This takes `tone`:
 * a caller that can pass arbitrary classes can put anything on screen,
 * including colours that exist in neither theme, and DESIGN.md's contrast
 * rules cannot survive that.
 *
 * `icon` is optional because the platform console's tiles are figures without
 * decoration — cross-tenant totals, where an icon per tile adds noise rather
 * than meaning.
 */
export function StatTile({
  icon,
  tone = 'primary',
  label,
  value,
  suffix,
  hint,
  className,
}: StatTileProps): JSX.Element {
  return (
    <div
      className={cn(
        'rounded-xl border border-surface-border bg-surface px-3.5 py-3.5',
        'dark:border-surface-border-dark dark:bg-surface-dark',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        {icon && <IconTile icon={icon} tone={tone} size="sm" />}
        <p className="text-sm font-semibold leading-5 text-content dark:text-content-dark">
          {label}
        </p>
      </div>
      <p
        className={cn(
          'flex items-baseline gap-1.5 font-display text-3xl font-bold leading-9',
          'text-content dark:text-content-dark',
          icon ? 'mt-3' : 'mt-2',
        )}
      >
        {value}
        {suffix && (
          <span className="text-sm font-medium text-content-muted dark:text-content-muted-dark">
            {suffix}
          </span>
        )}
      </p>
      {hint && (
        <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
          {hint}
        </p>
      )}
    </div>
  );
}
