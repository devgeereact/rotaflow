import { useEffect, useState } from 'react';

/**
 * Tracks a CSS media query from JavaScript.
 *
 * ## When to reach for this, and when not to
 *
 * Almost never. A responsive layout belongs in Tailwind's breakpoint variants,
 * which need no JavaScript, survive a resize with no re-render and cannot get
 * out of step with the stylesheet.
 *
 * This exists for the one thing a class cannot express: rendering a *different
 * element* at different widths. `MobileDisclosure` renders a real `<details>`
 * on a phone and a plain section on a desktop, and `<details open>` versus no
 * `<details>` at all is a DOM difference, not a style one. Rendering both and
 * hiding one would put every panel in the document twice, which duplicates
 * every heading and every focusable control for a screen-reader user.
 *
 * Defaults to `false` on the first render (and in a DOM-free test), so a
 * caller must be correct when the query has not been evaluated yet.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = (e: MediaQueryListEvent): void => setMatches(e.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Tailwind's `md` breakpoint. The width at which the app stops being a phone. */
export function useIsPhone(): boolean {
  return useMediaQuery('(max-width: 767px)');
}
