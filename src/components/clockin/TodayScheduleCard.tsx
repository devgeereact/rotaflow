import { CalendarDays, MapPin } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ClockCardHeading } from '@/components/clockin/ClockCardHeading';
import { cn } from '@/lib/utils';

export type ScheduleEntryTone = 'upcoming' | 'break';

export interface TodayScheduleEntry {
  id: string;
  timeRange: string;
  title: string;
  /** Only the shift rows carry a location in the reference; breaks do not. */
  locationName?: string;
  badgeLabel: string;
  tone: ScheduleEntryTone;
}

interface TodayScheduleCardProps {
  entries: TodayScheduleEntry[];
  onViewFull?: () => void;
}

const TONES: Record<ScheduleEntryTone, string> = {
  upcoming: 'bg-clock-tint text-clock-fg dark:bg-clock/20 dark:text-clock-tint',
  break: 'bg-info/15 text-primary dark:bg-info/20',
};

/** "Today's Schedule" rail card — the day's shift plus its unpaid break. */
export function TodayScheduleCard({
  entries,
  onViewFull,
}: TodayScheduleCardProps): JSX.Element {
  return (
    <Card className="rounded-xl p-5">
      <ClockCardHeading
        icon={CalendarDays}
        title="Today's Schedule"
        action={
          <button
            type="button"
            onClick={onViewFull}
            className="rounded text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            View Full Schedule
          </button>
        }
      />

      <ul className="mt-5">
        {entries.map((entry, index) => (
          <li
            key={entry.id}
            className={cn(
              index > 0 && 'mt-4 border-t border-divider pt-4 dark:border-divider-dark',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-base text-content dark:text-content-dark">
                {entry.timeRange}
              </p>
              <span
                className={cn(
                  'shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold',
                  TONES[entry.tone],
                )}
              >
                {entry.badgeLabel}
              </span>
            </div>
            <p className="mt-1.5 text-base font-semibold text-content dark:text-content-dark">
              {entry.title}
            </p>
            {entry.locationName && (
              <p className="mt-1.5 flex items-center gap-1.5 text-sm text-content-muted dark:text-content-muted-dark">
                <MapPin size={14} aria-hidden="true" />
                {entry.locationName}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
