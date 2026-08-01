import { ArrowUpRight, Info } from 'lucide-react';

/** The blue advisory strip along the foot of design/Locations-Management.png. */
export function LocationsTipBanner({
  onOpenGuide,
}: {
  onOpenGuide: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl bg-primary/10 px-5 py-4 dark:bg-primary/15">
      <span
        aria-hidden="true"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-primary-fg"
      >
        <Info size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-content dark:text-content-dark">
          Tip: Keep locations up to date
        </p>
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Accurate location details help improve scheduling, travel planning and
          compliance reporting.
        </p>
      </div>
      <button
        type="button"
        onClick={onOpenGuide}
        className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-surface-border bg-surface px-4 text-sm font-semibold text-primary transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:hover:bg-surface-subtle-dark"
      >
        Location Best Practices
        <ArrowUpRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
