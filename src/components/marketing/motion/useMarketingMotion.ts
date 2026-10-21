import { useEffect, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * Starts the marketing scroll motion (`marketingMotion.ts`) for one public
 * page, and puts the page back at the top when it opens.
 *
 * Progressive enhancement, in three ways:
 *
 * - The module is a dynamic `import()`, so GSAP and Lenis are their own
 *   chunk and never reach the entry chunk, the app shell, or the service
 *   worker's precache. Staff who only ever open `/app` never download them.
 * - It loads after first paint, so it cannot delay the page being readable.
 * - It loads only when `prefers-reduced-motion` is `no-preference`.
 *   `useMediaQuery` reports `false` until it has evaluated the query, so the
 *   default, and every test run under Playwright's `reducedMotion: 'reduce'`,
 *   is the page with no motion at all.
 *
 * A failed import (offline, since the chunk is deliberately not precached)
 * is swallowed: the page is complete without it.
 */
export function useMarketingMotion(root: RefObject<HTMLElement>): void {
  const { pathname, hash } = useLocation();
  const allowMotion = useMediaQuery('(prefers-reduced-motion: no-preference)');

  // Every marketing page renders its own layout, so this runs once per page.
  // Without it a link in the footer opened the next page scrolled to the
  // footer. A hash is left alone: `/resources#…` scrolls itself to the topic.
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);

  useEffect(() => {
    const el = root.current;
    if (!allowMotion || !el) return;

    let cancelled = false;
    let stop: (() => void) | undefined;
    const frame = window.requestAnimationFrame(() => {
      import('./marketingMotion')
        .then(({ startMarketingMotion }) => {
          if (!cancelled) stop = startMarketingMotion(el);
        })
        .catch(() => undefined);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      stop?.();
    };
  }, [allowMotion, root]);
}
