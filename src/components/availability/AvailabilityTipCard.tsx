import { ArrowUpRight, BellRing } from 'lucide-react';

interface AvailabilityTipCardProps {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}

/** Nudge card closing the rail. Prompts managers to chase stale availability. */
export function AvailabilityTipCard({
  title,
  body,
  actionLabel,
  onAction,
}: AvailabilityTipCardProps): JSX.Element {
  return (
    <div className="rounded-xl bg-primary/5 p-4 dark:bg-primary/10">
      <div className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary dark:bg-primary/20">
          <BellRing size={15} aria-hidden="true" />
        </span>
        <p className="text-sm font-semibold text-content dark:text-content-dark">
          {title}
        </p>
      </div>
      <p className="mt-2.5 text-sm text-content-muted dark:text-content-muted-dark">
        {body}
      </p>
      <button
        type="button"
        onClick={onAction}
        className="mt-3 inline-flex items-center gap-1.5 rounded text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {actionLabel}
        <ArrowUpRight size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
