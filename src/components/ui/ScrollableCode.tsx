import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ScrollableCodeProps {
  /** Names the region for a screen reader, e.g. "Invitation link". */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * A one-line `<code>` box that scrolls sideways, and can be scrolled without a
 * mouse.
 *
 * ## Why this exists
 *
 * Four places render a freshly-created invitation URL into a single-line
 * `overflow-x-auto` `<code>` next to a Copy button — the Team invite manager,
 * the onboarding import modal, and two platform console screens. That string is
 * ~90 characters of token in a 12px mono box, so the visible portion is always a
 * fraction of it. A pointer user drags it; a keyboard user cannot scroll a bare
 * `<code>` at all, so the half of the URL that matters, the token, was
 * unreachable with nothing on screen to say so (WCAG 2.2 Level A, 2.1.1
 * Keyboard; `docs/SAAS.md` GAP-070, and axe's `scrollable-region-focusable`).
 *
 * `ScrollRegion` is the fix for the tables. It is the wrong shape here: it wraps
 * the scroller in a positioned `div` and appends a "scrolls sideways for more
 * columns" line, and these boxes sit inside a `flex items-center` row beside a
 * button, where both would move the layout and neither sentence would be true.
 * So this takes the same three attributes and nothing else.
 *
 * `role="region"` displaces the element's implicit `code` role. That is the
 * trade the technique asks for and it is worth taking: "Invitation link,
 * region" tells a screen-reader user what the new tab stop is, which is the
 * whole reason the tab stop is allowed to exist. An unnamed one would be worse
 * than leaving the bug.
 */
export function ScrollableCode({
  label,
  children,
  className,
}: ScrollableCodeProps): JSX.Element {
  return (
    <code
      className={cn('overflow-x-auto', className)}
      // A scrollable region is the documented exception to the
      // no-noninteractive-tabindex rule — it is not interactive, and it must
      // still be reachable by keyboard, which is why the rule's own `roles`
      // option lists `region`. Same disable, same reason, as `ScrollRegion`.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      {children}
    </code>
  );
}
