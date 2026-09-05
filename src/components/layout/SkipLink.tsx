/**
 * "Skip to main content" — WCAG 2.2 Level A, 2.4.1 Bypass Blocks.
 *
 * There was none on any of the three shells until 5 September 2026
 * (docs/SAAS.md GAP-069). A keyboard or screen-reader user landing on any
 * authenticated screen had to tab through the organisation switcher, the
 * search trigger and eleven navigation links before reaching the page they
 * had just navigated to — on every navigation, because the sidebar is
 * re-rendered above the content in the DOM.
 *
 * Hidden until focused, which is the point: the first Tab on a fresh page
 * reveals it, and everyone else never sees it. `sr-only` alone would leave
 * it invisible to the sighted keyboard user who needs to know where the
 * focus went, so `focus:not-sr-only` brings it back into the layout.
 *
 * The target must be focusable for the jump to move focus and not merely
 * scroll, so every `<main>` that pairs with this carries `tabIndex={-1}`.
 * Without that, Safari and Firefox move the viewport and leave focus at the
 * top of the document, and the next Tab goes back to the second nav link.
 */
export function SkipLink(): JSX.Element {
  return (
    <a
      href="#main-content"
      className="sr-only rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
    >
      Skip to main content
    </a>
  );
}
