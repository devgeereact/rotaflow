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
 * and the offline outbox. No jsdom, no component rendering; add those when
 * there is a reason, not by default.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    // Node, not jsdom. The outbox suite brings its own IndexedDB via
    // fake-indexeddb, which is cheaper and more deterministic than a full DOM.
    environment: 'node',
    // `supabase/functions` is Deno and is excluded from typecheck and lint, so
    // CLAUDE.md's "no automated check stands in for reading those files" holds
    // for the request handling — it needs Deno, a JWT and OpenRouter. It does
    // not have to hold for pure logic extracted out of one. `grounding.ts`
    // decides whether a manager is shown an invented date; that is worth a
    // test, and it imports nothing from Deno so it runs here unchanged.
    include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts'],

    env: {
      // NOT the developer's zone, and NOT UTC either.
      //
      // .github/workflows/ci.yml pins TZ=UTC for the build because a
      // predecessor repo shipped a timezone bug that was invisible on a UK
      // machine. The inverse is just as real and is what these tests actually
      // caught: UTC has no DST, so a UTC-only run cannot see a day-arithmetic
      // bug that only exists when the clocks change. `resolvePeriod` was
      // returning a zero-length window on 25 Oct 2026 in Europe/London and
      // every CI run was green.
      //
      // Europe/London is the default because it is RotaFlow's primary market
      // and it has DST. Two zones, two bug classes; neither covers the other.
      TZ: 'Europe/London',

      // src/lib/supabase.ts calls createClient() at module scope and throws on
      // an empty URL, so any test that transitively reaches it needs these.
      // Deliberately fake and obviously so — no test here makes a network call,
      // and if one ever did it would fail against this host, which is what we
      // want. A unit suite that silently talked to the real project is worse.
      //
      // These are a backstop, NOT a licence to import `src/services` in a test.
      // Constructing a Supabase client also initialises Realtime, which needs a
      // global WebSocket — Node 20 (what CI runs) has none, and the whole file
      // dies with "Node.js detected but native WebSocket not found". That is
      // exactly why `sumApprovedLeaveDays` now lives in
      // `src/lib/leaveEntitlement.ts`. Keep pure logic out of `src/services`
      // and this never comes up; if you must import a service, mock it.
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key-not-a-real-credential',
    },
  },
});
