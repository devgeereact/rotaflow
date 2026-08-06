import { CheckCircle2, Eye, History } from 'lucide-react';
import { Card } from '@/components/ui/Card';

interface PublishStatusBarProps {
  /** "Published by James Davis". Null when the rota has never been published. */
  publishedBy: string | null;
  /** Pre-formatted, e.g. "Today, 10:24". */
  publishedAtLabel: string | null;
  /** Pre-formatted, e.g. "2 minutes ago". Omitted when nobody has opened it yet. */
  teamLastViewedLabel: string | null;
  onViewHistory: () => void;
}

/**
 * The strip under the grid confirming the rota is live to the team, who put it
 * there and when it was last read (design/published-schedule.png +
 * design/live-schedule.png, merged).
 */
export function PublishStatusBar({
  publishedBy,
  publishedAtLabel,
  teamLastViewedLabel,
  onViewHistory,
}: PublishStatusBarProps): JSX.Element {
  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-success/10 text-success"
        >
          <CheckCircle2 size={18} />
        </span>
        <div>
          <p className="text-[0.8rem] font-semibold text-content dark:text-content-dark">
            {publishedBy ?? 'This rota is published and visible to your team.'}
          </p>
          {publishedAtLabel && (
            <p className="text-xs text-content-muted dark:text-content-muted-dark">
              {publishedAtLabel} · visible to your team
            </p>
          )}
        </div>
      </div>

      {teamLastViewedLabel && (
        <>
          <span
            aria-hidden="true"
            className="hidden h-8 w-px bg-surface-border sm:block dark:bg-surface-border-dark"
          />
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
            >
              <Eye size={18} />
            </span>
            <div>
              <p className="text-[0.8rem] font-semibold text-content dark:text-content-dark">
                Team last viewed
              </p>
              <p className="text-xs text-content-muted dark:text-content-muted-dark">
                {teamLastViewedLabel}
              </p>
            </div>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={onViewHistory}
        className="ml-auto flex h-10 items-center gap-2 rounded-xl border border-surface-border px-4 text-sm font-semibold text-content transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
      >
        <History size={16} aria-hidden="true" />
        View change history
      </button>
    </Card>
  );
}
