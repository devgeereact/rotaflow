import { Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface ReportsTipBannerProps {
  title: string;
  body: string;
  actionLabel: string;
  actionIcon: LucideIcon;
  onAction: () => void;
}

/** The tinted hint strip under the report table (docs/design/Reports-Dashboard.png). */
export function ReportsTipBanner({
  title,
  body,
  actionLabel,
  actionIcon: ActionIcon,
  onAction,
}: ReportsTipBannerProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-primary/15 bg-primary/5 px-6 py-3 dark:border-primary/25 dark:bg-primary/10">
      <span
        aria-hidden="true"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-primary-fg"
      >
        <Info size={14} strokeWidth={2.5} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-6 text-content dark:text-content-dark">
          {title}
        </p>
        <p className="text-[0.8rem] font-medium leading-6 text-content dark:text-content-muted-dark">
          {body}
        </p>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="flex h-11 items-center gap-2 rounded-xl border border-surface-border bg-surface px-4 text-sm font-semibold text-primary dark:text-primary-ink-dark transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:hover:bg-surface-subtle-dark"
      >
        <ActionIcon size={16} aria-hidden="true" />
        {actionLabel}
      </button>
    </div>
  );
}
