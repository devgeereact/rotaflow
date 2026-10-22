/**
 * Whether `src/main.tsx` should hydrate the markup already inside `#root`.
 *
 * Only when that markup was prerendered for the path being visited. The
 * marker is written by `scripts/prerender.mjs`; the 404 page carries none, so
 * it is always rendered fresh (the unknown path is not the one it was built
 * for), and the plain app shell carries none because it has no markup.
 */
export function shouldHydrate(marker: string | undefined, pathname: string): boolean {
  if (!marker) return false;
  return normalisePath(marker) === normalisePath(pathname);
}

function normalisePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}
