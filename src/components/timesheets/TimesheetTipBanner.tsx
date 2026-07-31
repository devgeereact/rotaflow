import { ArrowUpRight, Info } from 'lucide-react';

interface TimesheetTipBannerProps {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}

/** The tinted hint strip under the table (design/Timesheets-Dashboard.png). */
export function TimesheetTipBanner({
  title,
  body,
  actionLabel,
  onAction,
}: TimesheetTipBannerProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-primary/15 bg-primary/5 p-4 dark:border-primary/25 dark:bg-primary/10">
      <span
        aria-hidden="true"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-primary-fg"
      >
        <Info size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.8rem] font-semibold text-content dark:text-content-dark">
          {title}
        </p>
        <p className="text-[0.78rem] text-content-muted dark:text-content-muted-dark">
          {body}
        </p>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-surface px-4 text-[0.8rem] font-semibold text-primary transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:hover:bg-surface-subtle-dark"
      >
        {actionLabel}
        <ArrowUpRight size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
