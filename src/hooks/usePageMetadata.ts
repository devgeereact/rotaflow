import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { BRAND } from '@/lib/brand';
import { publicRouteFor } from '@/lib/publicRoutes';
import { appOrigin } from '@/lib/appOrigin';

/**
 * Everything a browser tab, a search result and a link preview show, for one
 * public route. See `docs/HOOKS.md` §12 for the contract.
 *
 * ## What this replaces
 *
 * `MarketingLayout` set `document.title` and nothing else. `index.html` held
 * one `<meta description>` for all sixteen public pages, there was no
 * `<link rel="canonical">` and no Open Graph or Twitter card anywhere in the
 * repository, and the four auth routes plus the 404 set no title at all — a
 * password-reset page whose tab read "RotaFlow — Scheduling certainty for
 * every shift".
 *
 * ## Why the tags are written here rather than served in the HTML
 *
 * This is a static SPA: one `index.html` for every route, so per-route tags
 * can only be set once React has mounted. Every crawler that matters for
 * search renders JavaScript and sees them. Several LINK PREVIEW scrapers do
 * not — Slack, WhatsApp and iMessage read the raw HTML — which is why
 * `index.html` keeps a complete, honest set of site-level defaults: those
 * scrapers get the real card, just not a per-page one. Pre-rendering the
 * sixteen public routes would fix that properly and is a bigger change than
 * this one.
 *
 * ## Cleanup
 *
 * Only the title is restored on unmount, matching the previous behaviour. The
 * tags are overwritten by the next route that mounts, and the app's own routes
 * are `noindex` anyway by virtue of needing a session.
 */
export interface PageMetadata {
  /** Overrides the route's own title. The brand name is appended. */
  title?: string;
  /** Overrides the route's own description. */
  description?: string;
  /** Ask crawlers not to index this page. Used by the 404. */
  noindex?: boolean;
}

function setMeta(
  selector: string,
  attribute: 'name' | 'property',
  key: string,
  value: string,
): void {
  let tag = document.head.querySelector<HTMLMetaElement>(selector);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', value);
}

function setLink(rel: string, href: string): void {
  let tag = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement('link');
    tag.setAttribute('rel', rel);
    document.head.appendChild(tag);
  }
  tag.setAttribute('href', href);
}

export function usePageMetadata(overrides: PageMetadata = {}): void {
  const { pathname } = useLocation();
  const { title, description, noindex } = overrides;

  useEffect(() => {
    const route = publicRouteFor(pathname);
    const pageTitle = title ?? route?.title ?? BRAND.tagline;
    const pageDescription = description ?? route?.description ?? BRAND.description;
    // Trailing slash only for the root, so `/features` and `/features/` do not
    // become two URLs claiming to be canonical for each other.
    const canonical = `${appOrigin()}${pathname === '/' ? '/' : pathname.replace(/\/$/, '')}`;
    const fullTitle = `${pageTitle} · ${BRAND.name}`;

    const previousTitle = document.title;
    document.title = fullTitle;

    setMeta('meta[name="description"]', 'name', 'description', pageDescription);
    setLink('canonical', canonical);

    setMeta('meta[property="og:title"]', 'property', 'og:title', fullTitle);
    setMeta(
      'meta[property="og:description"]',
      'property',
      'og:description',
      pageDescription,
    );
    setMeta('meta[property="og:url"]', 'property', 'og:url', canonical);

    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', fullTitle);
    setMeta(
      'meta[name="twitter:description"]',
      'name',
      'twitter:description',
      pageDescription,
    );

    // Written only when asked for, and removed again on the way out: a
    // `noindex` left behind by a 404 the visitor navigated away from would
    // quietly de-index the page they landed on next.
    if (noindex) {
      setMeta('meta[name="robots"]', 'name', 'robots', 'noindex, follow');
    }

    return () => {
      document.title = previousTitle;
      if (noindex) {
        document.head.querySelector('meta[name="robots"]')?.remove();
      }
    };
  }, [pathname, title, description, noindex]);
}
