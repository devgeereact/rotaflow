import { BRAND } from '@/lib/brand';
import { publicRouteFor } from '@/lib/publicRoutes';

/**
 * The title, description and canonical URL for one path. Shared by
 * `usePageMetadata`, which writes them into the live page, and the build-time
 * prerender (`src/entry-prerender.tsx`), which writes them into the static
 * HTML, so a crawler and a browser are told the same thing.
 */
export interface ResolvedPageMetadata {
  /** The page title with the brand appended. */
  fullTitle: string;
  description: string;
  canonical: string;
}

export interface PageMetadataOverrides {
  title?: string;
  description?: string;
}

export function resolvePageMetadata(
  pathname: string,
  origin: string,
  overrides: PageMetadataOverrides = {},
): ResolvedPageMetadata {
  const route = publicRouteFor(pathname);
  const pageTitle = overrides.title ?? route?.title ?? BRAND.tagline;
  const description = overrides.description ?? route?.description ?? BRAND.description;
  // Trailing slash only for the root, so `/features` and `/features/` do not
  // become two URLs claiming to be canonical for each other.
  const path = pathname === '/' ? '/' : pathname.replace(/\/$/, '');
  return {
    fullTitle: `${pageTitle} · ${BRAND.name}`,
    description,
    canonical: `${origin.replace(/\/$/, '')}${path}`,
  };
}
