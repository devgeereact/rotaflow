import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import pkg from './package.json';

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
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
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
          'Multi-tenant, offline-first staff rota scheduling — build and share rotas in minutes; clock in, swap shifts and manage leave from any device.',
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
