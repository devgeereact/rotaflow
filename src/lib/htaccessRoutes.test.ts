import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_ROUTES } from '@/lib/publicRoutes';

/**
 * `.htaccess` and the route table in `App.tsx` must agree.
 *
 * Since 2026-10-22 the server answers a path that is neither a file nor a
 * known route with a real 404 (`.htaccess`, step 5). "Known" is a list of
 * first path segments in one `RewriteRule`. That makes a new failure possible:
 * add `/careers` to `App.tsx` and forget the list, and every visit to it
 * without a service worker is a 404 from the server, while the dev server and
 * every unit test say the page works.
 *
 * So this reads both files, the same way `navigationTargets.test.ts` reads the
 * route table rather than rendering it, and fails in both directions: a route
 * missing from the list, or a list entry whose route is gone (a stale entry
 * would quietly answer 200 for a page that no longer exists).
 *
 * Routes inside the `import.meta.env.DEV` block are excluded: they do not exist
 * in a production build, so the server is right to 404 them.
 */

const ROOT = process.cwd();
const APP_SOURCE = readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
const HTACCESS = readFileSync(path.join(ROOT, '.htaccess'), 'utf8');
const PRERENDER_SCRIPT = readFileSync(path.join(ROOT, 'scripts/prerender.mjs'), 'utf8');

/** Removes every `{import.meta.env.DEV && ( ... )}` block from the source. */
function withoutDevBlocks(source: string): string {
  const opener = '{import.meta.env.DEV && (';
  let result = source;
  for (;;) {
    const start = result.indexOf(opener);
    if (start === -1) return result;
    let depth = 0;
    let end = -1;
    for (let i = start + opener.length - 1; i < result.length; i += 1) {
      const char = result[i];
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) throw new Error('Unterminated DEV block in App.tsx');
    result = result.slice(0, start) + result.slice(end + 1);
  }
}

/** First path segment of every absolute `<Route path>` outside the DEV block. */
function productionSegments(): string[] {
  const source = withoutDevBlocks(APP_SOURCE);
  const segments = new Set<string>();
  for (const match of source.matchAll(/\bpath=\s*"(\/[^"]*)"/g)) {
    const first = match[1]!.split('/')[1] ?? '';
    if (first !== '' && first !== '*') segments.add(first);
  }
  return [...segments].sort();
}

/** The alternation in the `app-routes` RewriteRule. */
function htaccessSegments(): string[] {
  const rule = /^\s*RewriteRule \^\(([^)]+)\)\(\/\.\*\)\?\$ index\.html \[L\]\s*$/m.exec(
    HTACCESS,
  );
  if (!rule) throw new Error('.htaccess has no app-routes RewriteRule');
  return rule[1]!.split('|').sort();
}

describe('.htaccess route allowlist', () => {
  const routes = productionSegments();
  const allowed = htaccessSegments();

  it('reads a plausible route table', () => {
    // Guards the parser itself: an empty or tiny result would make the
    // comparisons below pass against nothing.
    expect(routes).toEqual(expect.arrayContaining(['app', 'admin', 'login', 'legal']));
    expect(routes).not.toContain('appboot');
    expect(routes.some((segment) => segment.endsWith('-preview'))).toBe(false);
  });

  it('lets every production route through to the app', () => {
    expect(routes.filter((segment) => !allowed.includes(segment))).toEqual([]);
  });

  it('carries no entry for a route that no longer exists', () => {
    expect(allowed.filter((segment) => !routes.includes(segment))).toEqual([]);
  });

  it('covers every public page, prerendered or not', () => {
    const publicSegments = PUBLIC_ROUTES.map(
      (route) => route.path.split('/')[1] ?? '',
    ).filter((segment) => segment !== '');
    expect(publicSegments.filter((segment) => !allowed.includes(segment))).toEqual([]);
  });

  it('preloads every lazy page the prerender writes, so hydration can keep it', () => {
    const block = /const PRERENDERED_LAZY_PAGES[^{]*\{([^}]*)\}/.exec(APP_SOURCE);
    if (!block) throw new Error('App.tsx has no PRERENDERED_LAZY_PAGES');
    const preloaded = [...block[1]!.matchAll(/'([^']+)':/g)].map((m) => m[1]!);
    // `/` and `/login` are eager imports in App.tsx and never suspend.
    const prerendered = PUBLIC_ROUTES.filter((route) => route.sitemap)
      .map((route) => route.path)
      .filter((routePath) => routePath !== '/' && routePath !== '/login');
    expect(prerendered.filter((routePath) => !preloaded.includes(routePath))).toEqual([]);
    expect(preloaded.filter((routePath) => !prerendered.includes(routePath))).toEqual([]);
  });

  it('answers everything else with a real 404 and the prerendered page', () => {
    const appRules = HTACCESS.indexOf('# app-routes:');
    const notFound = HTACCESS.indexOf('RewriteRule ^ - [R=404,L]');
    expect(appRules).toBeGreaterThan(-1);
    expect(notFound).toBeGreaterThan(appRules);
    expect(HTACCESS).toMatch(/^ErrorDocument 404 \/prerendered\/404\.html$/m);
    expect(PRERENDER_SCRIPT).toContain("'404.html'");
  });

  it('still refuses source maps and forces HTTPS before any of it', () => {
    const https = HTACCESS.indexOf(
      'RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]',
    );
    const maps = HTACCESS.indexOf('RewriteRule \\.map$ - [F,L]');
    const prerendered = HTACCESS.indexOf('RewriteRule ^$ prerendered/index.html [L]');
    expect(https).toBeGreaterThan(-1);
    expect(maps).toBeGreaterThan(https);
    expect(prerendered).toBeGreaterThan(maps);
  });
});
