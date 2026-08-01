import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Test config, deliberately separate from vite.config.ts.
 *
 * Importing the app config here would pull in VitePWA, which tries to generate
 * a service worker for a test run. The only thing tests need from it is the
 * `@` alias, so that is duplicated rather than shared.
 *
 * What is worth testing in this repo, and why these settings:
 *
 * RotaFlow turns clock events into hours and hours into pay. The bugs that
 * matter are arithmetic and timezone bugs in a handful of pure modules, not
 * render bugs — a mis-rendered button is visible, a shift silently missing from
 * a schedule is not. So this is a Node-environment unit suite over `src/lib`
 * and the pure parts of `src/services`, plus the offline outbox. No jsdom, no
 * component rendering; add those when there is a reason, not by default.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    // Node, not jsdom. The outbox suite brings its own IndexedDB via
    // fake-indexeddb, which is cheaper and more deterministic than a full DOM.
    environment: 'node',
    include: ['src/**/*.test.ts'],

    // NOT the developer's zone, and NOT UTC either.
    //
    // .github/workflows/ci.yml pins TZ=UTC for the build because a predecessor
    // repo shipped a timezone bug that was invisible on a UK machine. The
    // inverse is just as real and is what these tests actually caught: UTC has
    // no DST, so a UTC-only test run cannot see a day-arithmetic bug that only
    // exists when the clocks change. `resolvePeriod` was returning a
    // zero-length window on 25 Oct 2026 in Europe/London and no CI run would
    // ever have reproduced it.
    //
    // Europe/London is the default because it is RotaFlow's primary market and
    // it has DST. Individual tests that care about a specific zone set it
    // explicitly with `vi.stubEnv`/`process.env.TZ` rather than relying on this.
    env: {
      TZ: 'Europe/London',

      // src/lib/supabase.ts calls createClient() at module scope, and
      // createClient throws on an empty URL — so importing ANY module in
      // src/services (even for a pure, exported helper like
      // sumApprovedLeaveDays) would fail at import time without these.
      //
      // Deliberately fake and obviously so. Nothing in the suite makes a
      // network call; the client is constructed and never used. If a test ever
      // does hit the network it will fail against this host, which is the
      // outcome we want — a unit suite that silently talked to a real project
      // would be far worse.
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key-not-a-real-credential',
    },
  },
});
