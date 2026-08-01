import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SiteMetric } from '@/lib/locationsDirectory';

interface SiteMetricGridProps {
  metrics: SiteMetric[];
  /** Fired for the boxes whose hint is a `link` ("View staff →"). */
  onFollow: (id: string) => void;
  className?: string;
}

/**
 * The 2×3 grid of bordered mini-stats inside both detail panels
 * (design/Locations-Management.png, design/Location-department.png).
 *
 * Nothing truncates here: at the rail's width a clipped "Staff As…" is worse
 * than a label that wraps to two lines.
 */
export function SiteMetricGrid({
  metrics,
  onFollow,
  className,
}: SiteMetricGridProps): JSX.Element {
  return (
    <div className={cn('grid grid-cols-3 gap-2', className)}>
      {metrics.map((metric) => (
        <div
          key={metric.id}
          className="min-h-20 rounded-lg border border-surface-border px-2 py-2.5 dark:border-surface-border-dark"
        >
          <p className="text-xs leading-4 text-content-muted dark:text-content-muted-dark">
            {metric.label}
          </p>
          <p
            className={cn(
              'mt-1 font-bold text-content dark:text-content-dark',
              // "52" and "95%" get the reference's display size; "60 residents"
              // would need a 100px box at that size, so word values step down.
              metric.value.length > 5 ? 'text-base leading-5' : 'text-xl leading-7',
            )}
          >
            {metric.value}
          </p>
          {metric.hint &&
            (metric.hintTone === 'link' ? (
              <button
                type="button"
                onClick={() => onFollow(metric.id)}
                className="mt-0.5 inline-flex items-center gap-1 rounded text-left text-xs font-semibold leading-4 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {metric.hint}
                <ArrowRight size={12} aria-hidden="true" className="shrink-0" />
              </button>
            ) : (
              <p className="mt-0.5 text-xs leading-4 text-content-muted dark:text-content-muted-dark">
                {metric.hint}
              </p>
            ))}
        </div>
      ))}
    </div>
  );
}
