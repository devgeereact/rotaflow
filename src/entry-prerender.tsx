/* eslint-disable react-refresh/only-export-components -- a Node build entry, never hot-reloaded */
import { StrictMode, type JSX } from 'react';
import { prerenderToNodeStream } from 'react-dom/static';
import { StaticRouter } from 'react-router-dom';
import { App } from '@/App';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PUBLIC_ROUTES } from '@/lib/publicRoutes';
import {
  resolvePageMetadata,
  type PageMetadataOverrides,
  type ResolvedPageMetadata,
} from '@/lib/pageMetadata';

/**
 * Build-time prerender of the public pages. Never shipped to a browser.
 *
 * `scripts/prerender.mjs` builds this file for Node (`vite build --ssr`),
 * calls `render` once per public route, and writes the HTML under
 * `dist/prerendered/`, where `.htaccess` serves it to anyone who asks for that
 * URL without a service worker: crawlers, link-preview scrapers and visitors
 * with JavaScript off. `src/main.tsx` hydrates it in place, so a visitor with
 * JavaScript gets the same markup and nothing is re-rendered or replayed.
 *
 * The tree here must stay the tree `src/main.tsx` renders (StrictMode,
 * ErrorBoundary, App) or hydration finds a different page and throws it away.
 *
 * `prerenderToNodeStream` rather than `renderToString` because most public
 * pages are lazy routes: `renderToString` would write the Suspense fallback,
 * while a prerender waits for every lazy chunk and writes the page itself.
 */
function Page({ url }: { url: string }): JSX.Element {
  return (
    <StrictMode>
      <ErrorBoundary>
        <App
          renderRouter={(children) => (
            <StaticRouter location={url}>{children}</StaticRouter>
          )}
        />
      </ErrorBoundary>
    </StrictMode>
  );
}

export async function render(url: string): Promise<string> {
  const { prelude } = await prerenderToNodeStream(<Page url={url} />);
  const chunks: Buffer[] = [];
  for await (const chunk of prelude) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The pages worth prerendering: the ones the sitemap advertises. */
export const PRERENDER_PATHS: readonly string[] = PUBLIC_ROUTES.filter(
  (route) => route.sitemap,
).map((route) => route.path);

export function metadataFor(
  pathname: string,
  origin: string,
  overrides?: PageMetadataOverrides,
): ResolvedPageMetadata {
  return resolvePageMetadata(pathname, origin, overrides);
}
