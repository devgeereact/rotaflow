import { History, TimerReset } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ClockCardHeading } from '@/components/clockin/ClockCardHeading';
import { cn } from '@/lib/utils';

export interface ClockActivityEntry {
  id: string;
  /** 'in' renders the green icon, 'out' the red one (design/clockin.png). */
  kind: 'in' | 'out';
  label: string;
  timeLabel: string;
  locationName: string;
  /** Shown right-aligned on clock-outs only — the shift length worked. */
  durationLabel?: string;
}

interface RecentActivityCardProps {
  entries: ClockActivityEntry[];
  onViewAll?: () => void;
}

/** "Recent Activity" rail card — the last few clock events. */
export function RecentActivityCard({
  entries,
  onViewAll,
}: RecentActivityCardProps): JSX.Element {
  return (
    <Card className="rounded-xl p-5">
      <ClockCardHeading
        icon={History}
        title="Recent Activity"
        action={
          <button
            type="button"
            onClick={onViewAll}
            className="rounded text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            View All
          </button>
        }
      />

      <ul className="mt-5 space-y-4">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-start gap-3">
            <TimerReset
              size={18}
              aria-hidden="true"
              className={cn(
                'mt-0.5 shrink-0',
                entry.kind === 'in' ? 'text-clock' : 'text-danger',
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-content dark:text-content-dark">{entry.label}</p>
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
    </Card>
  );
}
