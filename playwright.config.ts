import { defineConfig, devices } from '@playwright/test';

/**
 * E2E smoke suite (`docs/SAAS.md`).
 *
 * Runs against `npm run dev`, not the production build: the `-preview` routes
 * these tests use to reach role-specific screens without a live Supabase
 * session are gated behind `import.meta.env.DEV` and compiled out of
 * production entirely (see the comment above the preview routes in
 * `src/App.tsx`) — a `vite preview` server serving `dist/` would 404 every
 * one of them. `npm run dev` runs in dev mode in CI exactly as it does
 * locally, so this is deliberate, not a shortcut.
 *
 * Chromium only for now: this is a smoke suite guarding critical paths and
 * WCAG basics on every PR, not full cross-browser coverage. Widen when that
 * coverage is actually needed.
 */
/**
 * The port is 5042 (the project's allocated dev port, `strictPort` in
 * `vite.config.ts`) unless `E2E_PORT` says otherwise.
 *
 * A second working copy of this repository keeps the same allocated port on
 * purpose — a diverging port committed on a branch lands on `main` at merge —
 * so `strictPort` fails loudly when two copies run at once. That is the
 * intended behaviour for `npm run dev`, and the wrong behaviour for a test
 * run: an e2e suite in a second worktree should not have to stop the server
 * somebody is working against. `E2E_PORT` is the documented override, and it
 * is passed through to Vite on the command line rather than committed.
 */
const PORT = process.env.E2E_PORT ?? '5042';
const BASE_URL = `http://localhost:${PORT}`;

/**
 * The second server, and why there has to be one.
 *
 * Everything above runs against `npm run dev`, deliberately: the `-preview`
 * routes are `import.meta.env.DEV`-only and a production build 404s them.
 *
 * But the service worker is compiled out of dev entirely
 * (`vite.config.ts` -> `devOptions.enabled: false`), so nothing in that suite
 * can observe a cache, an update prompt or an offline read. GAP-072 and
 * GAP-054 both ask for exactly that, and both stayed NOT TESTED because there
 * was nowhere to run them. The `pwa` project below serves `dist/` with
 * `vite preview`, which is the only place in this repository where a real
 * service worker exists.
 *
 * The port is the `5041` slot, which the machine's port registry reserves to
 * this project's block and nothing else uses, so a preview run does not
 * collide with the dev server on 5042.
 */
const PREVIEW_PORT = process.env.E2E_PREVIEW_PORT ?? '5041';
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

/** The `pwa` project's specs. Nothing else may run against `dist/`. */
const PWA_TESTS = /pwa-.*\.spec\.ts$/;

/**
 * Opt in, because the preview server costs a production build.
 *
 * Playwright starts every entry in `webServer` whatever `--project` says, so
 * declaring both unconditionally would make the ordinary suite build `dist/`
 * on every run, and would take the 5041 port whether or not anything used it.
 * `E2E_PWA=1` adds the project and its server alongside the dev one.
 * `E2E_PWA=only` also drops the dev server, which is what a PWA-only run
 * wants: 5042 is usually somebody's working dev server and starting a second
 * one there fails the whole run before a test executes.
 */
const PWA = process.env.E2E_PWA === '1' || process.env.E2E_PWA === 'only';
const PWA_ONLY = process.env.E2E_PWA === 'only';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Several hero/CTA sections fade in via `animate-fade-up`. An axe scan
    // mid-transition reads a partially-transparent element's contrast and
    // reports a different, non-reproducible violation set run to run — not a
    // real bug, a race between the scan and the animation. The app already
    // has (now) a `motion-reduce:` variant on every one of these
    // (docs/BRAND.md "respect reduced motion"), so forcing it here is
    // simultaneously the fix and a real assertion that that variant works.
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: PWA_TESTS,
    },
    ...(PWA
      ? [
          {
            name: 'pwa',
            use: { ...devices['Desktop Chrome'], baseURL: PREVIEW_URL },
            testMatch: PWA_TESTS,
          },
        ]
      : []),
  ],
  webServer: [
    // The dev server, for every project except `pwa`. Skipped entirely on a
    // PWA-only run: it would claim 5042 for nothing, and 5042 is usually
    // somebody's working dev server.
    ...(PWA_ONLY
      ? []
      : [
          {
            command: `npm run dev -- --port ${PORT}`,
            url: BASE_URL,
            /**
             * Never reuse a running server for a live-Supabase run.
             *
             * `e2e/platform-console.spec.ts` seeds fixtures over the service role and
             * then drives the browser against them, so the browser and the fixture
             * have to be pointed at the SAME Supabase. Reusing whatever dev server
             * happened to be listening breaks that silently: the server was started
             * with a different `VITE_SUPABASE_URL`, the account exists on one instance
             * and the sign-in happens on the other, and the only symptom is "Invalid
             * login credentials".
             *
             * On a developer's machine that other instance is production. So a live
             * run starts its own server with the environment it was given, and fails
             * loudly on a busy port rather than quietly on the wrong database.
             */
            reuseExistingServer: !process.env.CI && process.env.E2E_LIVE_SUPABASE !== '1',
            timeout: 60_000,
          },
        ]),
    ...(PWA
      ? [
          {
            // `vite preview` serves whatever is already in `dist/`, so the
            // build has to happen first. Building here rather than expecting
            // the caller to remember it: a stale `dist/` is a test that passes
            // against last week's service worker, which is worse than one that
            // fails.
            command: `npm run build && npm run preview -- --port ${PREVIEW_PORT}`,
            url: PREVIEW_URL,
            reuseExistingServer: false,
            timeout: 300_000,
          },
        ]
      : []),
  ],
});
