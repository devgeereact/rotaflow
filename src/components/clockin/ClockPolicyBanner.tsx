import { ExternalLink, Info } from 'lucide-react';

interface ClockPolicyBannerProps {
  title: string;
  body: string;
  /**
   * Omitted on `/app/clock`: the reference's "View Policy" opens a policy
   * screen that does not exist (docs/LOOP.md lists settings-policy as not
   * built), and a button that goes nowhere is worse than no button.
   */
  onViewPolicy?: () => void;
}

/** Full-width policy notice above the clock-in grid (docs/design/clockin.png). */
export function ClockPolicyBanner({
  title,
  body,
  onViewPolicy,
}: ClockPolicyBannerProps): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-primary-wash px-5 py-4 dark:bg-primary-wash-dark">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-primary-fg">
          <Info size={14} aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold text-content dark:text-content-dark">
            {title}
          </p>
          {/* `content`, not `content-muted`: this banner sits on a tinted
              wash where muted grey is 4.34 : 1, under the 4.5 : 1 line
              (GAP-030). The semibold title above carries the hierarchy. */}
          <p className="text-sm text-content dark:text-content-muted-dark">{body}</p>
        </div>
      </div>
      {onViewPolicy && (
        <button
          type="button"
          onClick={onViewPolicy}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-surface-border bg-surface px-3 text-sm font-semibold text-primary transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:hover:bg-surface-subtle-dark"
        >
          View Policy
          <ExternalLink size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
