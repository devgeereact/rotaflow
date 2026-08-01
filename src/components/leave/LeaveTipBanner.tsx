import { ArrowUpRight, Info } from 'lucide-react';

interface LeaveTipBannerProps {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}

/**
 * The tinted hint strip under the request table (design/Leave.png).
 *
 * Sized for this reference — its rows are taller and its type a step larger
 * than `TimesheetTipBanner`'s, which is otherwise the same idea. Worth
 * collapsing into one `ui/` primitive once both screens are settled.
 */
export function LeaveTipBanner({
  title,
  body,
  actionLabel,
  onAction,
}: LeaveTipBannerProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3.5 dark:border-primary/25 dark:bg-primary/10">
      <span
        aria-hidden="true"
        className="grid h-6 w-6 shrink-0 place-items-center self-start rounded-full bg-primary text-primary-fg"
      >
        <Info size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.85rem] font-bold leading-6 text-content dark:text-content-dark">
          {title}
        </p>
        <p className="text-[0.82rem] leading-6 text-content-muted dark:text-content-muted-dark">
          {body}
        </p>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-surface px-4 text-[0.85rem] font-semibold text-primary transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:hover:bg-surface-subtle-dark"
      >
        {actionLabel}
        <ArrowUpRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
