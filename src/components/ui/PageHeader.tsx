import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  /** One line under the title. Every reference screen has one; keep it. */
  description?: string;
  /** Right-aligned actions. Buttons, filters, a search field. */
  actions?: ReactNode;
  /** Tab bar or breadcrumb rendered below the title block. */
  below?: ReactNode;
  /**
   * An identity mark for a detail screen, an avatar or initials disc, drawn
   * to the left of the title. Entity screens only: a list screen has nothing
   * to be the identity of.
   */
  avatar?: ReactNode;
  /**
   * A row of badges and facts under the title, in place of `description`.
   *
   * A detail screen's subtitle is not a sentence. It is an identifier, a plan,
   * a status and a creation date, and each of those wants its own treatment.
   */
  meta?: ReactNode;
  className?: string;
}

/**
 * The title block every /app screen opens with.
 *
 * ## Why this exists
 *
 * Before this component there were 26 hand-rolled `<h1>` blocks across the app
 * and they used **three different sizes for the same role**, `text-2xl` (19
 * of them), `text-3xl` (10) and `text-xl` (4). `design/designsystem.png` names
 * exactly one Page Title style, 32/40 Semibold, and `tailwind.config.ts` has
 * carried a `text-page-title` token for it the whole time. It was used three
 * times in the entire codebase.
 *
 * That is what "the screens look slightly different from each other" is made
 * of: not a wrong colour anywhere, just the same heading rendered at 24px on
 * Schedule and 30px on Staff. Routing every page title through one component
 * is the only way that stays fixed, a token nobody is obliged to use drifts
 * again on the next screen.
 */
export function PageHeader({
  title,
  description,
  actions,
  below,
  avatar,
  meta,
  className,
}: PageHeaderProps): JSX.Element {
  return (
    <header className={cn('mb-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {avatar}
          <div className="min-w-0">
            <h1 className="text-balance font-display text-page-title font-semibold tracking-[-0.5px] text-content dark:text-content-dark">
              {title}
            </h1>
            {description && (
              // Capped at 64 characters: past that a one-line purpose becomes a
              // paragraph the eye has to track back across, and every one of
              // these sits directly above dense content.
              <p className="mt-1.5 max-w-[64ch] text-sm text-content-muted dark:text-content-muted-dark">
                {description}
              </p>
            )}
            {meta && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-content-muted dark:text-content-muted-dark">
                {meta}
              </div>
            )}
          </div>
        </div>
        {/* `shrink-0` so a long title wraps rather than crushing the actions,
            which are the only things on the row that can be clicked. */}
        {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
      </div>
      {below && <div className="mt-5">{below}</div>}
    </header>
  );
}
