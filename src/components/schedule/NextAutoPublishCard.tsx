import { History } from 'lucide-react';
import { Card } from '@/components/ui/Card';

interface NextAutoPublishCardProps {
  /** Pre-formatted, e.g. "2 June 2025 at 00:00". */
  whenLabel: string;
}

/** "Next auto-publish" tile at the top of the schedule rail (design/live-schedule.png). */
export function NextAutoPublishCard({
  whenLabel,
}: NextAutoPublishCardProps): JSX.Element {
  return (
    <Card className="flex items-center gap-2.5 bg-surface-subtle p-3 dark:bg-surface-subtle-dark">
      <span
        aria-hidden="true"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
      >
        <History size={18} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[0.8rem] font-semibold text-content dark:text-content-dark">
          Next auto-publish
        </p>
        <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
          {whenLabel}
        </p>
      </div>
    </Card>
  );
}
