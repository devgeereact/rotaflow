import { ArrowUpRight, Info } from 'lucide-react';

interface AnnouncementTipBannerProps {
  onAction: () => void;
}

/**
 * The tinted hint strip under the table (design/Announcements-Dashboard.png).
 * Copy is fixed. It is guidance about the feature, not about any one row.
 */
export function AnnouncementTipBanner({
  onAction,
}: AnnouncementTipBannerProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-primary/15 bg-primary/5 px-5 py-3.5 dark:border-primary/25 dark:bg-primary/10">
      <span
        aria-hidden="true"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-primary-fg"
      >
        <Info size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-4 font-semibold text-content dark:text-content-dark">
          Keep your team informed
        </p>
        <p className="text-xs leading-4 text-content-muted dark:text-content-muted-dark">
          Use announcements to share updates, policy changes, training reminders and
          important information with your team.
        </p>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-surface px-4 text-xs font-semibold text-primary transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:hover:bg-surface-subtle-dark"
      >
        View Announcement Best Practices
        <ArrowUpRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
