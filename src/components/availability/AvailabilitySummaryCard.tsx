import { Card } from '@/components/ui/Card';
import { AvailabilityDonut } from '@/components/availability/AvailabilityDonut';
import { cn } from '@/lib/utils';
import { STATE_DOT } from '@/lib/availabilityMatrix';
import type { AvailabilityBreakdown } from '@/lib/availabilityMatrix';

interface AvailabilitySummaryCardProps {
  segments: AvailabilityBreakdown[];
  centreTop: string;
  centreBottom: string;
}

/** Donut + labelled breakdown of the team's availability mix. */
export function AvailabilitySummaryCard({
  segments,
  centreTop,
  centreBottom,
}: AvailabilitySummaryCardProps): JSX.Element {
  return (
    <Card className="p-4">
      <h2 className="text-card-heading font-semibold text-content dark:text-content-dark">
        Availability Summary
      </h2>

      <div className="mt-3 flex items-center gap-3">
        <AvailabilityDonut
          segments={segments}
          centreTop={centreTop}
          centreBottom={centreBottom}
        />
        <dl className="min-w-0 flex-1 space-y-1.5">
          {segments.map((segment) => (
            <div key={segment.state} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn('h-2 w-2 shrink-0 rounded-full', STATE_DOT[segment.state])}
              />
              <dt className="min-w-0 flex-1 text-xs text-content dark:text-content-dark">
                {segment.label}
              </dt>
              <dd className="shrink-0 text-xs text-content-muted dark:text-content-muted-dark">
                {segment.percent}% ({segment.count})
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Card>
  );
}
