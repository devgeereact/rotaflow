import { expect, test, type Page } from '@playwright/test';

/**
 * Regressions for the shared responsive, keyboard and motion contracts
 * (`docs/DESIGN.md` §4, §5, §8).
 *
 * ## What these are for
 *
 * `app-surface.spec.ts` renders every screen at desktop width and runs axe over
 * it. That is a wide, shallow net, and it missed all three of the defects
 * below: a page header whose title collapsed to `Tea` at 390px, a dialog whose
 * close control was a 26px target, and a Button that kept its hover and press
 * transforms under `prefers-reduced-motion`. None of them is an axe violation
 * and none of them shows up at 1280px.
 *
 * ## Why they assert geometry rather than classes
 *
 * A test that asserts `sm:flex-row` is on an element proves a string is in a
 * className. These measure the rendered box, which is the thing that was
 * actually wrong, and which stays true if the implementation changes.
 *
 * `playwright.config.ts` forces `reducedMotion: 'reduce'` for the whole suite,
 * so the reduced-motion block below is the *default* and the "motion allowed"
 * case has to opt out of it explicitly.
 */

const PHONE = { width: 390, height: 844 };

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

test.describe('page header at phone width', () => {
  test.use({ viewport: PHONE });

  test('gives the title the full column and stacks the actions below it', async ({
    page,
  }) => {
    await acceptConsent(page);
    await page.goto('/app-preview/team');

    const title = page.getByRole('heading', { level: 1, name: 'Team' });
    await expect(title).toBeVisible();

    const titleBox = (await title.boundingBox())!;
    const primary = page.getByRole('button', { name: 'Add Staff' });
    const primaryBox = (await primary.boundingBox())!;

    // The failure this exists for: the title and the actions sharing one flex
    // line, with the title block shrunk to a few characters.
    expect(primaryBox.y).toBeGreaterThan(titleBox.y + titleBox.height);

    // The whole word, not `Tea`. `scrollWidth` is the text's natural width;
    // if the box is narrower than that, it is being clipped.
    const clipped = await title.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1 || el.clientWidth < 60,
    );
    expect(clipped).toBe(false);
  });

  test('puts the dominant action above the secondary ones', async ({ page }) => {
    await acceptConsent(page);
    await page.goto('/app-preview/team');

    const addBox = (await page.getByRole('button', { name: 'Add Staff' }).boundingBox())!;
    const exportBox = (await page.getByRole('button', { name: 'Export' }).boundingBox())!;
    expect(addBox.y).toBeLessThanOrEqual(exportBox.y);
  });

  test('the whole page never scrolls sideways', async ({ page }) => {
    await acceptConsent(page);

    for (const path of ['/app-preview/team', '/app-preview/clock', '/app-preview/']) {
      await page.goto(path);
      // Wait for the screen, not for a duration. A fixed `waitForTimeout` made
      // this flake under `fullyParallel`: it measured mid-layout, before the
      // webfont had swapped in and the grid had settled.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      // The app shell scrolls inside `main`, so the document is not the thing
      // to measure — `main` is.
      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const main = document.querySelector('main');
              return main ? main.scrollWidth - main.clientWidth : -1;
            }),
          { message: `no horizontal overflow on ${path}` },
        )
        .toBeLessThanOrEqual(1);
    }
  });

  test('the clock action is reachable inside the first phone viewport', async ({
    page,
  }) => {
    await acceptConsent(page);
    await page.goto('/app-preview/clock');

    const action = page.getByRole('button', { name: /clock in now/i });
    await expect(action).toBeVisible();
    const box = (await action.boundingBox())!;
    // It sat 1,370px down the page before the panels below it were reordered
    // and put behind disclosure.
    expect(box.y).toBeLessThan(PHONE.height);
  });
});

/**
 * The consent preferences panel is the one real `Modal` reachable without a
 * Supabase session: the banner's "Choose what to keep" opens it on any public
 * page. Every `*PreviewPage` stubs its modal callbacks, so a fixture screen
 * would be testing a no-op.
 */
async function openConsentDialog(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose what to keep' }).click();
}

test.describe('dialog keyboard flow', () => {
  test('opens with focus inside, traps Tab, closes on Escape and restores focus', async ({
    page,
  }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Choose what to keep' });
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // The accessible name comes from the rendered heading, not a duplicated
    // `aria-label` that can drift from it.
    await expect(dialog).toHaveAttribute('aria-labelledby', /.+/);

    const focusInsideDialog = async (): Promise<boolean> =>
      page.evaluate(() => {
        const el = document.activeElement;
        return Boolean(el && el.closest('[role="dialog"]'));
      });
    expect(await focusInsideDialog()).toBe(true);

    // Twenty tabs is far more than any dialog in this app has stops; if the
    // trap works, focus is still inside.
    for (let i = 0; i < 20; i += 1) await page.keyboard.press('Tab');
    expect(await focusInsideDialog()).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Focus goes back to what opened it, not to the top of the document.
    await expect(trigger).toBeFocused();
  });

  test('the close control meets the 44px touch target', async ({ page }) => {
    await openConsentDialog(page);
    const close = page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true });
    const box = (await close.boundingBox())!;
    // It was `p-1` around an 18px icon: a 26 × 26 target on the control every
    // dialog depends on. docs/DESIGN.md §5.
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test('locks background scrolling while open', async ({ page }) => {
    await openConsentDialog(page);
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });
});

test.describe('reduced motion', () => {
  test('a Button keeps its size on hover and press', async ({ page }) => {
    await acceptConsent(page);
    await page.goto('/app-preview/team');

    const button = page.getByRole('button', { name: 'Add Staff' });
    const before = (await button.boundingBox())!;
    await button.hover();
    await page.waitForTimeout(250);
    const hovered = (await button.boundingBox())!;

    // The global rule in `src/index.css` collapses the *duration*, which is
    // not the same thing: a `scale(1.02)` with no transition still scales,
    // instantly. `motion-reduce:hover:scale-100` is what removes it.
    expect(Math.abs(hovered.width - before.width)).toBeLessThan(0.5);
    expect(Math.abs(hovered.height - before.height)).toBeLessThan(0.5);

    // `none` or the identity matrix — `motion-reduce:hover:scale-100` resolves
    // to `scale(1)`, which computes as `matrix(1, 0, 0, 1, 0, 0)`. Either is a
    // control that did not move; what must never appear here is a scale.
    const transform = await button.evaluate((el) => getComputedStyle(el).transform);
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(transform);
  });

  test('the same Button does scale when motion is allowed', async ({ browser }) => {
    // Proves the assertion above is testing the reduced-motion branch and not
    // simply that the transform was deleted for everybody.
    const context = await browser.newContext({ reducedMotion: 'no-preference' });
    const page = await context.newPage();
    await acceptConsent(page);
    await page.goto('/app-preview/team');

    const button = page.getByRole('button', { name: 'Add Staff' });
    const before = (await button.boundingBox())!;
    await button.hover();
    await page.waitForTimeout(300);
    const hovered = (await button.boundingBox())!;
    expect(hovered.width).toBeGreaterThan(before.width);

    await context.close();
  });
});
