import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  /** One line under the title. Every reference screen has one; keep it. */
  description?: string;
  /** Right-aligned actions — buttons, filters, a search field. */
  actions?: ReactNode;
  /** Tab bar or breadcrumb rendered below the title block. */
  below?: ReactNode;
  className?: string;
}

/**
 * The title block every /app screen opens with.
 *
 * ## Why this exists
 *
 * Before this component there were 26 hand-rolled `<h1>` blocks across the app
 * and they used **three different sizes for the same role** — `text-2xl` (19
 * of them), `text-3xl` (10) and `text-xl` (4). `design/designsystem.png` names
 * exactly one Page Title style, 32/40 Semibold, and `tailwind.config.ts` has
 * carried a `text-page-title` token for it the whole time. It was used three
 * times in the entire codebase.
 *
 * That is what "the screens look slightly different from each other" is made
 * of: not a wrong colour anywhere, just the same heading rendered at 24px on
 * Schedule and 30px on Staff. Routing every page title through one component
 * is the only way that stays fixed — a token nobody is obliged to use drifts
 * again on the next screen.
 */
export function PageHeader({
  title,
  description,
  actions,
  below,
  className,
}: PageHeaderProps): JSX.Element {
  return (
    <header className={cn('mb-6', className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-page-title font-semibold text-content dark:text-content-dark">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
              {description}
            </p>
          )}
        </div>
        {/* `shrink-0` so a long title wraps rather than crushing the actions,
            which are the only things on the row that can be clicked. */}
        {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
      </div>
      {below && <div className="mt-5">{below}</div>}
    </header>
  );
}
