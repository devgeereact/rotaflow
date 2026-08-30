import { History, TimerReset } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ClockCardHeading } from '@/components/clockin/ClockCardHeading';
import { cn } from '@/lib/utils';
import type { ClockActivityEntry } from '@/lib/clockRows';

interface RecentActivityCardProps {
  entries: ClockActivityEntry[];
  onViewAll?: () => void;
}

/** Break events are not in the reference; amber keeps them distinct from both. */
const KINDS: Record<ClockActivityEntry['kind'], string> = {
  in: 'text-clock',
  out: 'text-danger',
  break: 'text-warning',
};

/** "Recent Activity" rail card. The last few clock events. */
export function RecentActivityCard({
  entries,
  onViewAll,
}: RecentActivityCardProps): JSX.Element {
  return (
    <Card className="flex h-full flex-col rounded-xl p-6">
      <ClockCardHeading
        icon={History}
        title="Recent Activity"
        action={
          <button
            type="button"
            onClick={onViewAll}
            className="rounded text-sm font-semibold text-primary dark:text-primary-ink-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            View All
          </button>
        }
      />

      {entries.length === 0 ? (
        <p className="mt-5 text-sm text-content-muted dark:text-content-muted-dark">
          No clock events yet. Your last few will appear here once you clock in.
        </p>
      ) : (
        <ul className="mt-5 space-y-4">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3">
              <TimerReset
                size={18}
                aria-hidden="true"
                className={cn('mt-0.5 shrink-0', KINDS[entry.kind])}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-content dark:text-content-dark">
                  {entry.label}
                </p>
                <p className="mt-0.5 text-sm text-content-muted dark:text-content-muted-dark">
                  {entry.timeLabel}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-content dark:text-content-dark">
                  {entry.locationName}
                </p>
              </div>
              {entry.durationLabel && (
                <span className="shrink-0 text-sm text-content-muted dark:text-content-muted-dark">
                  {entry.durationLabel}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
