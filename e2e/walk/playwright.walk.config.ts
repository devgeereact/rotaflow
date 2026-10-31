import { defineConfig, devices } from '@playwright/test';

/**
 * The local-live walk (docs/AUDIT.md, "Local-live walk"): the real app on Vite, the real PHP API on a LOCAL MariaDB
 * seeded by `backend/bin/seed-demo.php`, and real sign-in on the Clerk DEVELOPMENT instance with test-mode addresses
 * (`+clerk_test`, code 424242). Nothing here reaches the live server, live Clerk or Supabase.
 *
 * Start the pieces first (each in its own terminal), then run the walk:
 *   scripts/walk.sh db && scripts/walk.sh api      # terminal 1
 *   scripts/walk.sh web                            # terminal 2
 *   pnpm run e2e:walk                              # terminal 3 (or scripts/walk.sh e2e)
 *
 * One worker: the specs share one database and turn feature flags on and off.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.walk\.ts$/,
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list'], ['json', { outputFile: '../../test-results/walk-results.json' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env['WALK_BASE_URL'] ?? 'http://localhost:5042',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    contextOptions: { reducedMotion: 'reduce' },
  },
});
