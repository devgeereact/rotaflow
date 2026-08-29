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
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
