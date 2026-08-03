import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

interface AvailabilityStatCardProps {
  icon: LucideIcon;
  /** Tile classes, e.g. `bg-success/10 text-success`. */
  tint: string;
  label: string;
  value: string;
  hint: string;
}

/**
 * One tile in the summary row above the matrix (design/Availability.png):
 * a tinted icon tile, then label / value stacked beside it and a hint beneath.
 *
 * Deliberately a sibling of `TimesheetStatCard` rather than an import of it —
 * they are the same shape today, but promoting one to `components/ui` would
 * mean editing a screen another branch is actively matching. Worth folding into
 * a shared `StatTile` once both have settled.
 */
export function AvailabilityStatCard({
  icon: Icon,
  tint,
  label,
  value,
  hint,
}: AvailabilityStatCardProps): JSX.Element {
  return (
    <Card className="rounded-xl p-3">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', tint)}
        >
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-content-muted dark:text-content-muted-dark">
            {label}
          </p>
          <p className="text-2xl font-bold leading-8 text-content dark:text-content-dark">
            {value}
          </p>
        </div>
      </div>
      <p className="mt-1 truncate text-xs text-content-muted dark:text-content-muted-dark">
        {hint}
      </p>
    </Card>
  );
}
