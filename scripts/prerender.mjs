/**
 * Prerenders the public pages into `dist/prerendered/` after `vite build`.
 *
 * Until 2026-10-22 every URL on the site answered with the same empty
 * `index.html`, and the page only existed once React had run. Search crawlers
 * that render JavaScript coped; link-preview scrapers, visitors with
 * JavaScript off and any crawler that reads raw HTML got an empty `<div>`
 * and the site-level card. This writes one real HTML file per sitemap route,
 * with that page's title, description and canonical in the head, plus a
 * `404.html` that `.htaccess` serves with a real 404 status.
 *
 * How it fits together:
 *
 *   1. Build `src/entry-prerender.tsx` for Node (`vite build --ssr`) into a
 *      throwaway directory. `ROTAFLOW_PRERENDER_SSR=1` tells `vite.config.ts`
 *      to leave out the plugins that write deploy output.
 *   2. Render each path with the same component tree the browser runs, and
 *      put the markup inside the built `dist/index.html`, so every asset
 *      reference is the one this build emitted.
 *   3. `src/main.tsx` hydrates a page whose `data-prerendered` marker matches
 *      the path, so a visitor with JavaScript keeps the markup.
 *
 * The service worker never sees these files: its precache manifest is written
 * during `vite build`, before this runs, and `vite.config.ts` also ignores
 * `prerendered/**`. An installed visitor keeps getting the app shell.
 *
 *   node scripts/prerender.mjs        (run by `npm run build`)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const out = path.join(dist, 'prerendered');
const ssrDir = path.join(root, 'node_modules/.cache/rotaflow-prerender');

// Same rule as the sitemap in vite.config.ts: the production domain unless a
// build says otherwise. A canonical pointing at localhost would be worse than
// none.
const SITE_ORIGIN = (process.env['VITE_APP_URL'] ?? 'https://rotaflow.space').replace(
  /\/$/,
  '',
);

/** A path no route matches, rendered to produce the 404 page. */
const NOT_FOUND_PROBE = '/__rotaflow-not-found';

function fail(message) {
  console.error(`prerender: ${message}`);
  process.exit(1);
}

function escapeAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeText(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Replaces one `<meta>` tag's content, and fails loudly if it is missing. */
function setMeta(html, attribute, key, value) {
  const pattern = new RegExp(
    `<meta\\s+${attribute}="${key.replace(/[.:]/g, '\\$&')}"\\s+content="[^"]*"\\s*/?>`,
  );
  if (!pattern.test(html)) fail(`index.html has no <meta ${attribute}="${key}">`);
  return html.replace(
    pattern,
    `<meta ${attribute}="${key}" content="${escapeAttribute(value)}" />`,
  );
}

function setHead(html, { fullTitle, description, canonical }, { noindex = false } = {}) {
  let page = html.replace(
    /<title>[^<]*<\/title>/,
    `<title>${escapeText(fullTitle)}</title>`,
  );
  page = setMeta(page, 'name', 'description', description);
  page = setMeta(page, 'property', 'og:title', fullTitle);
  page = setMeta(page, 'property', 'og:description', description);
  page = setMeta(page, 'name', 'twitter:title', fullTitle);
  page = setMeta(page, 'name', 'twitter:description', description);
  if (noindex) {
    // A 404 is not a page anyone should be sent to, so it claims no URL.
    page = page.replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>\s*/, '');
    page = setMeta(page, 'property', 'og:url', `${SITE_ORIGIN}/`);
    page = page.replace(
      '</title>',
      '</title>\n    <meta name="robots" content="noindex, follow" />',
    );
  } else {
    page = page.replace(
      /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/,
      `<link rel="canonical" href="${escapeAttribute(canonical)}" />`,
    );
    page = setMeta(page, 'property', 'og:url', canonical);
  }
  return page;
}

function setBody(html, markup, marker) {
  const empty = '<div id="root"></div>';
  if (html.split(empty).length !== 2)
    fail('dist/index.html must hold exactly one empty #root');
  const attribute = marker ? ` data-prerendered="${escapeAttribute(marker)}"` : '';
  return html
    .replace(empty, `<div id="root"${attribute}>${markup}</div>`)
    .replace(/<noscript>[\s\S]*?<\/noscript>\s*/, '');
}

function fileFor(routePath) {
  return routePath === '/' ? 'index.html' : `${routePath.replace(/^\//, '')}.html`;
}

// ---- 1. Node build of the prerender entry -----------------------------------
const template = path.join(dist, 'index.html');
if (!existsSync(template)) fail('dist/index.html is missing; run `vite build` first');

rmSync(ssrDir, { recursive: true, force: true });
const build = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules/vite/bin/vite.js'),
    'build',
    '--ssr',
    'src/entry-prerender.tsx',
    '--outDir',
    ssrDir,
    '--emptyOutDir',
    '--logLevel',
    'warn',
  ],
  { cwd: root, stdio: 'inherit', env: { ...process.env, ROTAFLOW_PRERENDER_SSR: '1' } },
);
if (build.status !== 0) fail('the Node build of src/entry-prerender.tsx failed');

// ---- 2. Render ----------------------------------------------------------------
const entry = await import(pathToFileURL(path.join(ssrDir, 'entry-prerender.js')).href);
const shell = readFileSync(template, 'utf8');

rmSync(out, { recursive: true, force: true });
const written = [];

for (const routePath of entry.PRERENDER_PATHS) {
  const markup = await entry.render(routePath);
  // A page with no heading, or with a Suspense boundary still pending
  // (`<!--$?-->`), means a lazy route was written as its loading fallback.
  if (!/<h1[\s>]/.test(markup) || markup.includes('<!--$?-->')) {
    fail(`${routePath} rendered without its page content`);
  }
  const page = setBody(
    setHead(shell, entry.metadataFor(routePath, SITE_ORIGIN)),
    markup,
    routePath,
  );
  const file = path.join(out, fileFor(routePath));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, page, 'utf8');
  written.push(routePath);
}

const notFound = await entry.render(NOT_FOUND_PROBE);
if (!notFound.includes('This page doesn’t exist')) {
  fail('the 404 render is not NotFoundPage');
}
// The same title NotFoundPage gives itself through MarketingLayout.
const notFoundMeta = entry.metadataFor(NOT_FOUND_PROBE, SITE_ORIGIN, {
  title: 'Page not found',
});
writeFileSync(
  path.join(out, '404.html'),
  setBody(setHead(shell, notFoundMeta, { noindex: true }), notFound, null),
  'utf8',
);

rmSync(ssrDir, { recursive: true, force: true });
console.log(
  `prerender: ${written.length} public pages and 404.html written to dist/prerendered/`,
);
