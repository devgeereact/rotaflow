import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The service worker, the manifest and the update prompt, in a real build
 * (GAP-050, GAP-054).
 *
 * Everything else in `e2e/` runs against `npm run dev`, where the worker is
 * compiled out (`devOptions.enabled: false`), so until this file nothing in the
 * repository ever loaded the app from its precache or saw the update prompt
 * appear. It runs in the `pwa` project, which serves `dist/` with
 * `vite preview` (`playwright.config.ts`).
 *
 * It needs no Supabase stack. The shell, the manifest and the update path are
 * all static, and a build with no `VITE_*` variables is what CI produces anyway.
 */

/** The worker script `vite preview` serves, from the build this project made. */
const SW_PATH = resolve(process.cwd(), 'dist', 'sw.js');

/** Wait until a service worker is actually controlling the page. */
async function waitForController(page: Page): Promise<void> {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    undefined,
    {
      timeout: 60_000,
    },
  );
}

test.describe('the installed app', () => {
  test('ships a manifest whose icons resolve', async ({ page }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href, 'no <link rel="manifest"> in the document').toBeTruthy();

    const manifest = (await (await page.request.get(href ?? '')).json()) as {
      name: string;
      start_url: string;
      display: string;
      icons: { src: string; sizes: string }[];
    };
    expect(manifest.name).toBe('RotaFlow');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );
    for (const icon of manifest.icons) {
      const response = await page.request.get(`/${icon.src.replace(/^\//, '')}`);
      expect(response.status(), `${icon.src} did not resolve`).toBe(200);
      expect(response.headers()['content-type']).toContain('image/png');
    }
  });

  test('opens from its precache with no network', async ({ page, context }) => {
    await page.goto('/');
    await waitForController(page);

    await context.setOffline(true);

    // The landing page, reloaded with no network at all.
    await page.reload();
    await expect(
      page.getByRole('heading', { name: /rotas your team can actually follow/i }),
    ).toBeVisible();

    // A route never visited online: every lazy chunk is precached, so the
    // sign-in screen renders rather than a browser error page.
    await page.goto('/login');
    await expect(page.getByLabel('Email address')).toBeVisible();

    // A deep link into the app, offline and signed out, lands on sign-in
    // through `navigateFallback` rather than failing to load.
    await page.goto('/app/dashboard');
    await page.waitForURL(/\/login/);
    await expect(page.getByLabel('Email address')).toBeVisible();
  });

  test('offers a new version when one is deployed, and waits to be asked', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForController(page);
    await expect(page.getByText('A new version is available.')).toHaveCount(0);

    // A deploy, as the browser sees it: the same worker script with different
    // bytes. `vite preview` reads `dist/` from disk on every request, so the
    // file is changed in place and put back afterwards. A Playwright route
    // cannot do this: the browser fetches a worker script itself, outside the
    // page, and no route sees that request (tried, with and without
    // PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS).
    const original = await readFile(SW_PATH, 'utf8');
    await writeFile(SW_PATH, `${original}\n// next deploy ${Date.now()}\n`);
    try {
      // The hourly poll in `UpdatePrompt`, run now instead of in an hour.
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update();
      });

      const prompt = page
        .getByRole('status')
        .filter({ hasText: 'A new version is available.' });
      await expect(prompt).toBeVisible({ timeout: 30_000 });

      // `skipWaiting: false`: the new worker waits until the person accepts, so
      // a form in progress is never reloaded out from under them.
      const waiting = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration?.waiting !== null && registration?.waiting !== undefined;
      });
      expect(waiting, 'the new worker took over without being asked').toBe(true);

      // "Not now" hides it for this session and leaves the worker waiting.
      await page.getByRole('button', { name: 'Dismiss the update notice' }).click();
      await expect(prompt).toHaveCount(0);
      expect(
        await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.waiting !== null && registration?.waiting !== undefined;
        }),
      ).toBe(true);
    } finally {
      await writeFile(SW_PATH, original);
    }
  });
});
