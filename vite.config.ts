import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import checker from 'vite-plugin-checker';
import { visualizer } from 'rollup-plugin-visualizer';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import path from 'node:path';
import { execSync } from 'node:child_process';
import pkg from './package.json';

// The Sentry *release* identifier, distinct from `__APP_VERSION__` below:
// `pkg.version` has been "1.0.0" since the project's first commit and isn't
// bumped per deploy, so it can't answer "which build introduced this error".
// The commit this was built from can. Falls back to `pkg.version` only if
// git genuinely isn't available (a source tarball with no `.git`, say) —
// not for a dirty tree or a detached HEAD, both of which still resolve fine.
function resolveSentryRelease(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return pkg.version;
  }
}
const sentryRelease = resolveSentryRelease();

// https://vitejs.dev/config/
export default defineConfig({
  // Absolute base: rota.gakinz.com serves this bundle from its domain root,
  // not a cPanel sub-directory. A relative base ('./') resolves asset/manifest
  // URLs against the CURRENT route path, not the site root — so landing
  // directly on any nested route (e.g. /app/dashboard after sign-in) requests
  // assets from e.g. /app/assets/*, 404s, and gets index.html's HTML back for
  // a script/stylesheet request, which fails MIME-type checks and leaves a
  // blank page. Absolute paths resolve correctly regardless of route depth.
  base: '/',

  // Single source of truth for the version the splash/about surfaces show.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Read by src/lib/sentry.ts, so every error carries the commit it shipped
    // from — see `resolveSentryRelease` above for why this isn't __APP_VERSION__.
    __SENTRY_RELEASE__: JSON.stringify(sentryRelease),
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // Project block 04 in the workspace port scheme (see ~/.claude/CLAUDE.md, "Dev-server ports").
  // strictPort so a clash fails loudly instead of drifting to a random port —
  // a drifted port silently breaks Supabase redirect URLs and CORS allowlists.
  // 5042 is also in playwright.config.ts and the Supabase edge-function CORS
  // allowlist — sweep for `localhost:5042` before changing it.
  server: {
    port: 5042,
    strictPort: true,
  },
  preview: {
    port: 5042,
    strictPort: true,
  },

  plugins: [
    react(),

    VitePWA({
      // 'generateSW' lets Workbox build the service worker for us.
      strategies: 'generateSW',
      registerType: 'prompt', // we surface our own update UI; never auto-reload
      injectRegister: null, // registration handled manually in src/main.tsx

      // Files pulled into the precache manifest (the "app shell").
      includeAssets: ['favicon.svg', 'offline.html', 'icons/*.png'],

      manifest: {
        name: 'RotaFlow',
        short_name: 'RotaFlow',
        description:
          'UK-first workforce scheduling for shift-based teams. Build rotas, manage leave and swaps, track attendance and keep working when the signal drops.',
        theme_color: '#3B6FE0',
        background_color: '#FFFFFF',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        // Precache the shell so the SPA boots with no network.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // SPA navigations resolve to the precached index.html.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false, // wait for user to accept the update
        runtimeCaching: [
          {
            // ImageKit CDN — cache-first, images rarely change.
            urlPattern: /^https:\/\/ik\.imagekit\.io\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'imagekit-media',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Supabase REST/GraphQL reads — network-first with short fallback.
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts stylesheets + files.
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts' },
          },
        ],
      },

      devOptions: {
        enabled: false, // set true to debug the SW in `npm run dev`
      },
    }),

    // Live TS + ESLint errors in the dev overlay, instead of only finding out
    // at `npm run build` / CI. `enableBuild: false` because `npm run build`
    // already runs a separate `tsc --noEmit` — checking twice would just
    // slow the build down for the same answer.
    checker({
      typescript: true,
      eslint: { lintCommand: 'eslint "./src/**/*.{ts,tsx}"' },
      enableBuild: false,
    }),

    // Bundle breakdown, opt-in only: `ANALYZE=true npm run build`. Writes
    // stats.html at the repo root (gitignored, never shipped) rather than
    // running on every build.
    ...(process.env.ANALYZE
      ? [
          visualizer({
            filename: 'stats.html',
            open: true,
            gzipSize: true,
            brotliSize: true,
          }),
        ]
      : []),

    // Sourcemap upload for de-minified Sentry stack traces. `build.sourcemap`
    // above is 'hidden' — maps are emitted but never referenced or shipped;
    // this uploads them to Sentry then deletes them from `dist/`, so the only
    // way to read them is a Sentry account with access to this project, not
    // an unauthenticated GET like the old `sourcemap: true` was doing.
    //
    // No-ops without SENTRY_AUTH_TOKEN, so a build with no token configured
    // (every local build until this is set up) behaves exactly as before.
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            release: { name: sentryRelease },
            sourcemaps: { filesToDeleteAfterUpload: ['dist/**/*.js.map'] },
          }),
        ]
      : []),
  ],

  build: {
    outDir: 'dist',

    // 'hidden', not true. Maps are still emitted so Sentry can de-minify a stack
    // trace, but the `//# sourceMappingURL=` comment is left out of the bundle.
    //
    // With `true`, every shipped .js pointed at its .map and the production host
    // served them: https://rota.gakinz.com/assets/index-*.js.map returned 200 and
    // handed out the app's complete original TypeScript. That is not a secret leak
    // — VITE_* values are inlined into the bundle regardless, and the anon key is
    // public by design — but it does publish the exact shape of every Supabase
    // query, every RLS assumption and every role check to anyone probing a
    // multi-tenant app that holds staff PII. docs/DEPLOYMENT.md §4 already said not
    // to ship them; nothing enforced it.
    //
    // Defence in depth: .htaccess also refuses to serve *.map, so a future deploy
    // that copies them up is still safe.
    sourcemap: 'hidden',
    target: 'es2020',
    rollupOptions: {
      output: {
        // Split vendors so the app shell stays tiny and cache-stable.
        //
        // The last four entries are not optional. Once routes became lazy
        // (React.lazy in src/App.tsx), Rollup had no shared parent for the
        // libraries those routes pull in and emitted a chunk PER ICON and per
        // date-fns function — 104 chunks and a precache manifest that grew
        // from 1500 KiB to 1614 KiB on pure per-module boilerplate. For an
        // offline-first PWA that is the wrong trade: every entry is a request
        // the service worker must fetch on install, over the same ward wifi
        // this split exists to be kind to.
        //
        // Grouping them keeps the win (a 58% smaller entry chunk) without the
        // request storm. Tree-shaking still applies inside each group — the
        // icons chunk holds the icons actually imported, not all of lucide.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          motion: ['framer-motion'],
          icons: ['lucide-react'],
          dates: ['date-fns', 'date-fns-tz'],
          // Only the rota builder uses drag-and-drop, so this rides along with
          // that route's chunk rather than the entry.
          dnd: ['@dnd-kit/core', '@dnd-kit/utilities'],
        },
      },
    },
  },
});
