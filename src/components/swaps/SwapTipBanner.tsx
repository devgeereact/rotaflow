import { ArrowUpRight, Info } from 'lucide-react';

interface SwapTipBannerProps {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}

/** The tinted hint strip under the swap table (design/Swap-Request.png). */
export function SwapTipBanner({
  title,
  body,
  actionLabel,
  onAction,
}: SwapTipBannerProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3.5 dark:border-primary/25 dark:bg-primary/10">
      <span
        aria-hidden="true"
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-primary-fg"
      >
        <Info size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.8rem] font-semibold leading-5 text-content dark:text-content-dark">
          {title}
        </p>
        <p className="text-[0.75rem] leading-5 text-content-muted dark:text-content-muted-dark">
          {body}
        </p>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="flex h-9 items-center gap-2 rounded-xl border border-surface-border bg-surface px-4 text-[0.76rem] font-semibold text-primary transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:hover:bg-surface-subtle-dark"
      >
        {actionLabel}
        <ArrowUpRight size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
