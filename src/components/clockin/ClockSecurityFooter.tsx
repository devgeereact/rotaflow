import { ShieldCheck } from 'lucide-react';

interface ClockSecurityFooterProps {
  supportLine: string;
  contactLine: string;
  onReportIssue?: () => void;
}

/** Reassurance strip closing the clock-in screen (design/clockin.png). */
export function ClockSecurityFooter({
  supportLine,
  contactLine,
  onReportIssue,
}: ClockSecurityFooterProps): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 rounded-xl bg-primary/5 px-5 py-4 dark:bg-primary/10">
      <div className="flex items-start gap-3">
        <ShieldCheck
          size={20}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-primary"
        />
        <div>
          <p className="text-base font-semibold text-content dark:text-content-dark">
            Your data is secure and protected
          </p>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            RotaFlow uses industry-leading security to protect your information.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-5">
        <div className="text-right">
          <p className="text-sm font-semibold text-content dark:text-content-dark">
            {supportLine}
          </p>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            {contactLine}
          </p>
        </div>
        <button
          type="button"
          onClick={onReportIssue}
          className="inline-flex h-10 shrink-0 items-center rounded-lg border border-surface-border bg-surface px-4 text-sm font-semibold text-content transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
        >
          Report an Issue
        </button>
      </div>
    </div>
  );
}
