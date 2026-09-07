import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The page-title type style, at both widths.
 *
 * `text-page-title` is 32/40, a desktop measure. At 390px a two-word title
 * sharing a flex line with two action buttons had nothing left: `Team`
 * rendered as `Tea` and its one-line description wrapped a word at a time
 * (`docs/design-review/team-mobile.png`). Stacking the header fixes the
 * overflow; the step down to 24/32 is because 32px is simply too large for the
 * column the title then owns, not because shrinking type is a way to fit
 * things in. Both are the same weight and family.
 *
 * Exported so `PageHeader` and `WorkspaceHeader` cannot drift apart, which is
 * exactly what happened to the two of them before (`tracking-[-0.5px]` on one,
 * none on the other; `mb-5` against `mb-6`).
 */
export const HEADER_TITLE_CLASS =
  'text-balance font-display text-page-title-mobile font-semibold tracking-[-0.4px] text-content sm:text-page-title sm:tracking-[-0.5px] dark:text-content-dark';

/** The one-line purpose sentence under a title. */
export const HEADER_DESCRIPTION_CLASS =
  'mt-1.5 max-w-[64ch] text-sm text-content-muted dark:text-content-muted-dark';

export interface HeaderBarProps {
  /** The title block: heading, description or meta, and an optional avatar. */
  children: ReactNode;
  /**
   * The one dominant action for this page. Rendered **first on phones** and
   * last on desktop, so a thumb reaches it without scrolling past the
   * secondary controls while the familiar desktop right-edge order is kept.
   */
  primaryAction?: ReactNode;
  /** Secondary actions: export, import, a filter, an overflow menu. */
  actions?: ReactNode;
}

/**
 * The title/action row shared by `PageHeader` and `WorkspaceHeader`.
 *
 * ## Why a shared row rather than one header component
 *
 * The two headers express the same hierarchy with different spacing and
 * different subtitle treatment, which is a real inconsistency. They are not
 * the same component though: one carries an entity avatar and a meta row, the
 * other carries a route-backed tab bar, and merging them produces a component
 * with two mutually exclusive halves. So the *layout* is shared and the two
 * capabilities stay where they are.
 *
 * ## The responsive contract
 *
 * Below `lg` (1024px) the title block takes the full width and the actions
 * stack beneath it. Above it, they sit on one line with the actions pinned
 * right and unable to shrink.
 *
 * `lg`, not `sm`, because the breakpoint is on the **viewport** and the header
 * does not get the viewport. `AppShell`'s rail is 256px and appears from `md`
 * (768px) up, so a 768px window gives this header about 430px to work in — and
 * at `sm` it duly put the title and two buttons on one line there, wrapping
 * "Everyone in Sunnyvale Care Group…" a word at a time. 1024px is the first
 * width at which the content column itself clears 640px.
 *
 * A container query would express this properly, and Tailwind v3 has no
 * first-party one; adding a plugin for a single breakpoint is not worth the
 * config.
 *
 * The previous behaviour was not "actions wrap when they no longer fit": the
 * title block was `min-w-0 flex-1`, so it could shrink to nothing and the flex
 * line therefore *never* overflowed. Whether the header wrapped depended
 * entirely on how wide the buttons happened to be — the same header wrapped
 * inside `AppShell` and did not on a preview page with less padding. That is
 * why this is a breakpoint and not a `flex-wrap`.
 */
export function HeaderBar({
  children,
  primaryAction,
  actions,
}: HeaderBarProps): JSX.Element {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-4">
      <div className="flex min-w-0 items-start gap-3 lg:flex-1">{children}</div>
      {(primaryAction || actions) && (
        <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">
          {primaryAction && <div className="order-1 lg:order-2">{primaryAction}</div>}
          {actions && (
            <div
              className={cn('order-2 flex flex-wrap items-center gap-2', 'lg:order-1')}
            >
              {actions}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
