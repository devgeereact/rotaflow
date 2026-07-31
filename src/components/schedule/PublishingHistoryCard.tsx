import { CheckCircle2, History } from 'lucide-react';
import { Card } from '@/components/ui/Card';

export interface PublishEvent {
  id: string;
  /** "Published by James Davis" / "Auto-published". */
  label: string;
  /** Pre-formatted, e.g. "Today, 10:24". */
  timeLabel: string;
}

interface PublishingHistoryCardProps {
  events: PublishEvent[];
  onViewAll?: () => void;
}

/** When this rota was published, and by whom (design/live-schedule.png). */
export function PublishingHistoryCard({
  events,
  onViewAll,
}: PublishingHistoryCardProps): JSX.Element {
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-card-heading font-semibold text-content dark:text-content-dark">
          Publishing History
        </h2>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="text-xs font-medium text-primary hover:underline"
          >
            View all
          </button>
        )}
      </div>

      {events.length === 0 ? (
        <p className="flex items-center gap-2 border-t border-divider px-4 py-4 text-sm text-content-muted dark:border-divider-dark dark:text-content-muted-dark">
          <History size={14} aria-hidden="true" />
          Never published.
        </p>
      ) : (
        <ul className="space-y-3 border-t border-divider px-4 py-3 dark:border-divider-dark">
          {events.map((event) => (
            <li key={event.id} className="flex items-start gap-2.5">
              <CheckCircle2
                size={16}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-success"
              />
              <div className="min-w-0">
                <p className="truncate text-[0.8rem] font-semibold text-content dark:text-content-dark">
                  {event.label}
                </p>
                <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                  {event.timeLabel}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
