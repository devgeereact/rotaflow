import type { JSX } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';

export type PublicationState =
  /** Nothing rostered in the current scope yet. */
  | 'empty'
  /** Unpublished work. Staff cannot see it. */
  | 'draft'
  /** Published and locked. Staff are working to it. */
  | 'published'
  /** Editing a published week; staff still see the previous version. */
  | 'amending';

interface PublicationStatusProps {
  state: PublicationState;
  /** Issues that actually stop a publication. */
  criticalCount: number;
  /** Issues worth reading that do not block. */
  advisoryCount?: number;
  /** A failed publish attempt, which outranks everything below it. */
  publishError?: string | null;
  /**
   * `id` of the conflicts panel further down the page. Renders a "Review
   * issues" link that jumps to it. Omit where there is no such panel.
   */
  issuesAnchorId?: string;
  /**
   * The blocking issues themselves (design gap F23): the panel used to give
   * only a count, so a manager had to go looking for what to fix.
   */
  criticalIssues?: readonly { title: string; detail: string; shiftId: string | null }[];
  /** Opens a shift named by an issue. Without it the row offers no button. */
  onGoToShift?: (shiftId: string) => void;
}

const STATE_LABEL: Record<PublicationState, string> = {
  empty: 'Nothing rostered yet',
  draft: 'Draft · not visible to staff',
  published: 'Published · staff can view this version',
  amending: 'Amendment in progress · staff still see the published version',
};

/**
 * What state this week's rota is in, and separately, whether anything is
 * stopping it from being published.
 *
 * ## Why these are two things and not one
 *
 * They were one red panel headed "Draft, not visible to staff", with the
 * blocking-issue count as its body. Being a draft is the normal condition of
 * a rota that is being built — it is neutral, it is true for most of the time
 * a manager spends on this screen, and colouring it as an error teaches people
 * to ignore the colour. Two critical conflicts genuinely are red, and they are
 * a different fact about a different thing.
 *
 * So: a quiet status chip that is always present and always says exactly which
 * of the four states this is, and a red block that appears **only** when
 * something is actually blocking — carrying the count and a way to get to it.
 *
 * ## Why "Review issues" and not "See the Warnings tab"
 *
 * There is no Warnings tab. The conflicts are in a card below the grid, and
 * the copy had been pointing at a tab that does not exist in this build. A
 * link to the panel is both true and one click shorter.
 */
export function PublicationStatus({
  state,
  criticalCount,
  advisoryCount = 0,
  publishError = null,
  issuesAnchorId,
  criticalIssues = [],
  onGoToShift,
}: PublicationStatusProps): JSX.Element {
  const tone =
    state === 'published' ? 'success' : state === 'amending' ? 'info' : 'neutral';

  return (
    <div className="mb-3 sm:mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone} dot>
          {STATE_LABEL[state]}
        </Badge>
        {advisoryCount > 0 && criticalCount === 0 && (
          <Badge tone="warning">
            {advisoryCount} advisory {advisoryCount === 1 ? 'note' : 'notes'}
          </Badge>
        )}
      </div>

      {publishError ? (
        <Callout tone="danger" title="Couldn't publish" className="mt-3">
          {publishError}
        </Callout>
      ) : criticalCount > 0 ? (
        <div className="mt-3 rounded-lg border border-danger/30 bg-danger-wash px-4 py-3 dark:bg-danger-wash-dark">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-start gap-2.5 text-sm text-content dark:text-content-dark">
              <AlertTriangle
                size={18}
                aria-hidden="true"
                className="mt-px shrink-0 text-danger-ink dark:text-danger-ink-dark"
              />
              <span>
                <span className="font-semibold">
                  Fix {criticalCount} {criticalCount === 1 ? 'thing' : 'things'} to
                  publish.
                </span>
                {/* From `sm` up: on a phone the line wrapped and pushed the grid
                    below two-thirds of the screen (e2e/rota-grid.spec.ts). */}
                <span className="hidden sm:inline">
                  {' '}
                  Staff cannot see this week until{' '}
                  {criticalCount === 1 ? 'it is' : 'they are'} resolved.
                </span>
              </span>
            </p>
            {issuesAnchorId && (
              <a
                href={`#${issuesAnchorId}`}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-primary-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary dark:text-primary-ink-dark"
              >
                Review all issues
                <ArrowRight size={16} aria-hidden="true" />
              </a>
            )}
          </div>
          {/* From `sm` up only: on a phone the grid has to start in the top
              two-thirds of the screen (e2e/rota-grid.spec.ts, design review
              F6), so a phone gets the summary and "Review all issues". */}
          {criticalIssues.length > 0 && (
            <ul className="mt-2 hidden space-y-1.5 sm:block">
              {criticalIssues.slice(0, 5).map((issue) => (
                <li
                  key={`${issue.title}-${issue.shiftId ?? 'none'}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-danger/30 bg-surface px-3 py-2 text-sm dark:bg-surface-dark"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-content dark:text-content-dark">
                      {issue.title}
                    </span>
                    <span className="block text-content-muted dark:text-content-muted-dark">
                      {issue.detail}
                    </span>
                  </span>
                  {issue.shiftId && onGoToShift && (
                    <button
                      type="button"
                      onClick={() => onGoToShift(issue.shiftId as string)}
                      className="h-9 shrink-0 rounded-control border border-field bg-surface px-3 font-medium text-content hover:bg-surface-subtle focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary dark:border-field-dark dark:bg-surface-dark dark:text-content-dark"
                    >
                      Go to shift
                    </button>
                  )}
                </li>
              ))}
              {criticalIssues.length > 5 && (
                <li className="text-sm text-content dark:text-content-dark">
                  And {criticalIssues.length - 5} more in the issues list.
                </li>
              )}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
