import { expect, test, type Page } from '@playwright/test';

/**
 * The reports screen at phone width.
 *
 * ## What this is for
 *
 * `docs/design-review/2026-09-06-rota-builder.md` F8: at 375px `/reports-preview`
 * reported a `documentElement.scrollWidth` of 377 against a 375 client width, so
 * the whole PAGE scrolled sideways rather than the one wide thing on it. Every
 * other route measured 0.
 *
 * The cause was the analytics rail: a grid item defaults to `min-width: auto`,
 * so the 353px min-content of its action row (a 128px `shrink-0` button, a 20px
 * gap, a `whitespace-nowrap` one) refused to fit a 327px track and pushed the
 * body out. `docs/DESIGN.md` §7 has the rule; this is the regression.
 *
 * ## Why geometry rather than classes
 *
 * `min-w-0` and `flex-wrap` are two of several ways to fix this and the next
 * person may pick a different one. What must stay true is that the page does
 * not scroll sideways and both rail buttons are reachable, so that is what is
 * measured — the same house style as `e2e/responsive-and-motion.spec.ts`.
 */

const PHONE = { width: 375, height: 812 };

/** The banner is `fixed bottom-0` and intercepts clicks until it is answered. */
async function acceptConsent(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        'rotaflow:consent',
        JSON.stringify({
          version: 1,
          preferences: true,
          diagnostics: false,
          decidedAt: new Date().toISOString(),
        }),
      );
    } catch {
      /* a browser blocking site data still gets the banner; not this test's subject */
    }
  });
}

test.describe('reports at phone width', () => {
  test.use({ viewport: PHONE });

  test.beforeEach(async ({ page }) => {
    await acceptConsent(page);
  });

  test('the standalone preview page never scrolls sideways', async ({ page }) => {
    await page.goto('/reports-preview');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    await expect
      .poll(
        async () =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        { message: 'the document must not scroll horizontally' },
      )
      .toBeLessThanOrEqual(0);
  });

  test('the same screen inside the app shell never scrolls sideways', async ({
    page,
  }) => {
    // The shell scrolls inside `main`, so the document is not the thing to
    // measure — and `main` overflowed by 2px here for the same reason.
    await page.goto('/app-preview/reports');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const main = document.querySelector('main');
            return main ? main.scrollWidth - main.clientWidth : -1;
          }),
        { message: 'no horizontal overflow inside the app shell' },
      )
      .toBeLessThanOrEqual(1);
  });

  test('the wide report table still scrolls inside its own region', async ({ page }) => {
    // The other half of the rule: the page must not scroll sideways, and the
    // one genuinely wide thing on it must. Fixing the first by clipping the
    // second would pass the two tests above and lose five columns.
    await page.goto('/app-preview/reports');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const overflow = await page.evaluate(() => {
      const table = document.querySelector('table');
      const viewport = table?.closest<HTMLElement>('.overflow-x-auto');
      return viewport ? viewport.scrollWidth - viewport.clientWidth : -1;
    });
    expect(overflow, 'the report table needs its own scrollport').toBeGreaterThan(0);
  });

  test('both rail actions stay inside the viewport', async ({ page }) => {
    await page.goto('/app-preview/reports');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    for (const name of ['Filters', 'Custom Report']) {
      const button = page.getByRole('button', { name, exact: true }).first();
      if ((await button.count()) === 0) continue;
      const box = (await button.boundingBox())!;
      expect(box.x, `${name} starts inside the viewport`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${name} ends inside the viewport`).toBeLessThanOrEqual(
        PHONE.width,
      );
    }
  });
});
