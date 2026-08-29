#!/usr/bin/env node
/**
 * Bundle size gate (docs/SAAS.md CAP-101).
 *
 * Two bundle regressions have shipped to production, and both were found by a
 * human reading `dist/` months later, never by CI:
 *
 *   PR #75 — thirteen DEV-only preview pages were defined outside the
 *            `import.meta.env.DEV` guard. The route gate worked, so the pages
 *            were unreachable; but Rollup still emitted a chunk for each and
 *            Workbox precached all thirteen, so every visitor downloaded 87 kB
 *            of fabricated staff names on first load.
 *   PR #69 — a lazy route became a static import, so opening /app/clock pulled
 *            in the rest of the app.
 *
 * Neither changed a test, a type, or a lint rule. Both are only visible in the
 * built output, which is why this reads `dist/` and nothing else.
 *
 * Budgets live in `bundle-budget.json`, and raising one is meant to be a
 * reviewable diff rather than a flag on this script — the argument for a bigger
 * download belongs in a pull request, not in a CI invocation.
 *
 * Gzip is a proxy, not a promise: the origin serves brotli, so real transfer is
 * smaller. It is used because it is deterministic and available everywhere,
 * and a budget only has to be a stable yardstick, not an exact wire figure.
 *
 * Usage: `npm run check:bundle` after a build. Exits non-zero on a breach.
 */

import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';
const BUDGET_FILE = 'bundle-budget.json';

/** GitHub Actions renders `::error::` as an annotation on the PR. */
const isCI = process.env['CI'] === 'true';
const fail = (message) => {
  console.error(isCI ? `::error::${message}` : `ERROR: ${message}`);
};

function kib(bytes) {
  return Number((bytes / 1024).toFixed(1));
}

function gzipKib(paths) {
  let total = 0;
  for (const path of paths) total += gzipSync(readFileSync(path)).length;
  return kib(total);
}

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else found.push(path);
  }
  return found;
}

if (!existsSync(DIST)) {
  fail(`${DIST}/ does not exist. Run \`npm run build\` first.`);
  process.exit(1);
}

const budgets = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
const files = walk(DIST);

// ── what the service worker precaches ────────────────────────────────
// Parsed out of the emitted `sw.js` rather than recomputed from the file
// list, because the precache manifest and the chunk list are different
// things and the #75 regression was visible only in the former. Workbox
// minifies the manifest to `url:"…",revision:…`, so this reads the built
// artefact exactly as the browser will.
const swPath = join(DIST, 'sw.js');
if (!existsSync(swPath)) {
  fail('dist/sw.js missing — the PWA build produced no service worker.');
  process.exit(1);
}
const sw = readFileSync(swPath, 'utf8');
const precachedUrls = [...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);

if (precachedUrls.length === 0) {
  fail(
    'Parsed 0 precache entries from dist/sw.js. Workbox probably changed its ' +
      'output format, so this gate is measuring nothing — fix the parser rather ' +
      'than deleting the check.',
  );
  process.exit(1);
}

const precachedPaths = [];
const danglingUrls = new Set();
for (const url of precachedUrls) {
  const path = join(DIST, url.replace(/^\//, ''));
  if (existsSync(path)) precachedPaths.push(path);
  // A Set, because Workbox lists some files under more than one URL and
  // reporting the same missing name twice reads like two separate problems.
  else danglingUrls.add(url);
}

// ── the shipped payload ──────────────────────────────────────────────
// `.map` files are excluded because `cpanel-deploy` does not deploy them.
const shipped = files.filter(
  (f) => /\.(js|css)$/.test(f) && !f.endsWith('.map'),
);
const entryJs = files.filter((f) => /assets[/\\]index-[^/\\]+\.js$/.test(f));

if (entryJs.length !== 1) {
  fail(
    `Expected exactly one entry chunk (assets/index-*.js), found ${entryJs.length}. ` +
      'The build layout changed and this gate can no longer identify what blocks first paint.',
  );
  process.exit(1);
}

// ── the hard invariant: no DEV-only page in a production build ────────
// Not a budget. Preview pages are demo data with invented names, and one
// reaching production is wrong at any size — #75 shipped 87 kB of it. Checked
// in both places because they fail independently: a chunk can be emitted
// without being precached, and either is a regression.
const previewChunks = files.filter((f) => /preview/i.test(relative(DIST, f)));
const previewPrecached = precachedUrls.filter((u) => /preview/i.test(u));
const previewInSw = /PreviewPage/.test(sw);

const measurements = [
  {
    key: 'precacheGzipKiB',
    label: 'precache, gzip',
    unit: 'KiB',
    value: gzipKib(precachedPaths),
  },
  {
    key: 'precacheEntries',
    label: 'precache entries',
    unit: '',
    value: precachedUrls.length,
  },
  {
    key: 'entryJsGzipKiB',
    label: 'entry chunk, gzip',
    unit: 'KiB',
    value: gzipKib(entryJs),
  },
  {
    key: 'shippedGzipKiB',
    label: 'all JS+CSS, gzip',
    unit: 'KiB',
    value: gzipKib(shipped),
  },
];

// ── report ───────────────────────────────────────────────────────────
// Printed whether or not anything failed: the point of a budget is to make the
// number visible on every PR, so growth is noticed while it is still small.
console.log('Bundle budget\n');
const breaches = [];
for (const m of measurements) {
  const budget = budgets[m.key]?.budget;
  if (typeof budget !== 'number') {
    fail(`bundle-budget.json has no numeric budget for "${m.key}".`);
    process.exit(1);
  }
  const over = m.value > budget;
  if (over) breaches.push({ ...m, budget });
  const headroom = (((budget - m.value) / budget) * 100).toFixed(0);
  console.log(
    `  ${over ? '✗' : '✓'} ${m.label.padEnd(18)} ${String(m.value).padStart(7)}${m.unit} ` +
      `/ ${budget}${m.unit}  (${over ? 'OVER' : `${headroom}% headroom`})`,
  );
}
console.log('');

let failed = false;

if (danglingUrls.size > 0) {
  // A precached URL with no file behind it means every visitor's install step
  // 404s, and Workbox aborts the whole precache — the app silently stops
  // working offline while looking completely healthy online.
  fail(
    `${danglingUrls.size} precached URL(s) have no file in dist/: ` +
      `${[...danglingUrls].slice(0, 5).join(', ')}. Workbox aborts the entire precache ` +
      'on a single 404, so offline support is broken.',
  );
  failed = true;
}

if (previewChunks.length > 0 || previewPrecached.length > 0 || previewInSw) {
  fail(
    'DEV-only preview pages reached the production build. ' +
      `Chunks: ${previewChunks.length}, precached: ${previewPrecached.length}, ` +
      `named in sw.js: ${previewInSw}. ` +
      'Define preview routes with `devPage`, not `lazyPage` — gating the route is ' +
      'not enough, because the `import()` still runs at module scope and Rollup ' +
      'emits a chunk. See src/App.tsx.',
  );
  failed = true;
}

for (const b of breaches) {
  fail(
    `${b.label} is ${b.value}${b.unit}, over the ${b.budget}${b.unit} budget ` +
      `(+${(b.value - b.budget).toFixed(1)}${b.unit}). ` +
      'Find what grew before raising it: `npx vite build --mode production` prints ' +
      'per-chunk sizes, and a new large chunk usually means a lazy route became a ' +
      `static import. If the growth is intended, raise "${b.key}" in bundle-budget.json ` +
      'in the same PR and say why.',
  );
  failed = true;
}

if (failed) process.exit(1);
console.log('✅ Within budget, no DEV pages shipped, precache manifest intact.');
