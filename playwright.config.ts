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
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5042',
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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5042',
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
});
