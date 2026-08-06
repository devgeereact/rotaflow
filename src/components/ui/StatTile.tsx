import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { IconTile, type IconTileTone } from '@/components/ui/IconTile';
import { cn } from '@/lib/utils';

export interface StatTileProps {
  /** Omit for a figure-only tile. The platform console's default. */
  icon?: LucideIcon;
  tone?: IconTileTone;
  label: string;
  value: ReactNode;
  /** Small trailing unit next to the figure, e.g. `/ 5`. */
  suffix?: string;
  hint?: ReactNode;
  /** Where the figure came from. Renders the tile as a link. */
  to?: string;
  /** A `Sparkline` under the figure. Its recent shape, not a second number. */
  chart?: ReactNode;
  className?: string;
}

/**
 * The metric tile that sits above a dense list screen.
 *
 * ## Why this exists
 *
 * Seven near-identical versions of this component had grown across the app,
 * `dashboard/StatCard`, `staff/StaffStatCard`, `staff/StaffMetricCard`,
 * `timesheets/TimesheetStatCard`, `schedule/ScheduleStatCard`,
 * `availability/AvailabilityStatCard`, `locations/SiteStatCard`, plus
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
 * decoration. Cross-tenant totals, where an icon per tile adds noise rather
 * than meaning.
 */
export function StatTile({
  icon,
  tone = 'primary',
  label,
  value,
  suffix,
  hint,
  to,
  chart,
  className,
}: StatTileProps): JSX.Element {
  const body = (
    <>
      <div className="flex items-start gap-2.5">
        {icon && <IconTile icon={icon} tone={tone} size="sm" />}
        {/* Caption weight, not heading weight. The figure is the thing being
            read; a 14px ink label above it competed with the number it
            labels. docs/DESIGN.md §2 caption scale. */}
        <p className="text-xs font-medium leading-4 text-content-muted dark:text-content-muted-dark">
          {label}
        </p>
      </div>
      <p
        className={cn(
          'flex items-baseline gap-1.5 font-display text-[1.7rem] font-semibold leading-tight tracking-[-0.6px] tabular-nums',
          'text-content dark:text-content-dark',
          icon ? 'mt-2.5' : 'mt-1.5',
        )}
      >
        {value}
        {suffix && (
          <span className="text-sm font-medium tracking-normal text-content-muted dark:text-content-muted-dark">
            {suffix}
          </span>
        )}
      </p>
      {hint && (
        <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
          {hint}
        </p>
      )}
      {chart}
    </>
  );

  const shell = cn(
    'block rounded-2xl border border-surface-border bg-surface px-3.5 py-3.5 shadow-sm',
    'dark:border-surface-border-dark dark:bg-surface-dark',
    to &&
      'transition-colors hover:border-primary/45 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
    className,
  );

  // A tile that leads somewhere is a link, not a div with a click handler, // the console's tiles are the primary way into the screen they summarise,
  // and they have to be reachable by keyboard and openable in a new tab.
  return to ? (
    <Link to={to} className={shell}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}
