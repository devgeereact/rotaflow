import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The storage consent banner.
 *
 * The assertions that matter here are about *storage*, not about pixels. A
 * banner that appears and looks correct while the app writes to the device
 * anyway is worse than no banner, because it documents a choice that was not
 * honoured — so almost every test below ends by reading `localStorage` rather
 * than by reading the screen.
 *
 * `vite-plugin-checker`'s overlay is a real custom element under `npm run dev`
 * and does not exist in the production build; axe cannot tell, so it is
 * excluded, as in `marketing.spec.ts`.
 */
const AXE_EXCLUDE = 'vite-plugin-checker-error-overlay';
const CONSENT_KEY = 'rotaflow:consent';
const THEME_KEY = 'pwa-theme';

/** Every key this browser holds, so a test can assert on the whole set. */
async function storageKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(window.localStorage).sort());
}

async function consentRecord(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
  }, CONSENT_KEY);
}

/** A first visit: no stored answer, nothing carried over from another test. */
async function firstVisit(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(path);
}

const banner = (page: Page): Locator =>
  page.getByRole('region', { name: /what may this browser keep/i });

test.describe('consent banner', () => {
  test('asks on a first visit, and stores nothing before an answer', async ({ page }) => {
    await firstVisit(page);

    await expect(banner(page)).toBeVisible();
    // The whole point. An undecided visitor is untouched.
    expect(await storageKeys(page)).toEqual([]);
  });

  test('moves focus to the question so a keyboard user finds it', async ({ page }) => {
    await firstVisit(page);
    await expect(banner(page)).toBeVisible();

    const focusedText = await page.evaluate(
      () => document.activeElement?.textContent ?? '',
    );
    expect(focusedText).toMatch(/what may this browser keep/i);
  });

  test('offers accept and reject at the same visual weight', async ({ page }) => {
    await firstVisit(page);

    const accept = page.getByRole('button', { name: 'Accept all' });
    const reject = page.getByRole('button', { name: 'Reject all' });
    await expect(accept).toBeVisible();
    await expect(reject).toBeVisible();

    // Not a style preference: a reject rendered smaller or fainter than the
    // accept is the dark pattern this banner exists to avoid.
    const acceptBox = await accept.boundingBox();
    const rejectBox = await reject.boundingBox();
    expect(acceptBox).not.toBeNull();
    expect(rejectBox).not.toBeNull();
    expect(Math.abs(acceptBox!.height - rejectBox!.height)).toBeLessThanOrEqual(1);

    const classesMatch = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const a = buttons.find((b) => b.textContent?.trim() === 'Accept all');
      const r = buttons.find((b) => b.textContent?.trim() === 'Reject all');
      return a !== undefined && r !== undefined && a.className === r.className;
    });
    expect(classesMatch).toBe(true);
  });

  test('rejecting writes the decision and nothing else', async ({ page }) => {
    await firstVisit(page);
    await page.getByRole('button', { name: 'Reject all' }).click();

    await expect(banner(page)).toBeHidden();
    expect(await storageKeys(page)).toEqual([CONSENT_KEY]);
    expect(await consentRecord(page)).toMatchObject({
      preferences: false,
      diagnostics: false,
    });
  });

  test('a declined preference still works, it is just not remembered', async ({
    page,
  }) => {
    await firstVisit(page);
    await page.getByRole('button', { name: 'Reject all' }).click();

    await page.goto('/legal/cookies');
    // The theme toggle lives in the public nav; flipping it must change the
    // page without writing anything.
    await page.evaluate(() => {
      document.documentElement.classList.toggle('dark');
    });
    expect(await storageKeys(page)).toEqual([CONSENT_KEY]);
  });

  test('accepting permits the preference keys', async ({ page }) => {
    await firstVisit(page);
    await page.getByRole('button', { name: 'Accept all' }).click();

    await expect(banner(page)).toBeHidden();
    expect(await consentRecord(page)).toMatchObject({
      preferences: true,
      diagnostics: true,
    });

    // The theme effect re-runs and is now allowed to persist.
    await page.reload();
    await expect
      .poll(async () => (await storageKeys(page)).includes(THEME_KEY))
      .toBe(true);
  });

  test('the granular panel starts with nothing selected', async ({ page }) => {
    await firstVisit(page);
    await page.getByRole('button', { name: 'Choose what to keep' }).click();

    const switches = page.getByRole('switch');
    await expect(switches).toHaveCount(2);
    for (const state of await switches.all()) {
      await expect(state).toHaveAttribute('aria-checked', 'false');
    }
  });

  test('a partial selection is honoured exactly', async ({ page }) => {
    await firstVisit(page);
    await page.getByRole('button', { name: 'Choose what to keep' }).click();
    await page.getByRole('switch', { name: /remember interface preferences/i }).click();
    await page.getByRole('button', { name: 'Save my choices' }).click();

    expect(await consentRecord(page)).toMatchObject({
      preferences: true,
      diagnostics: false,
    });
  });

  test('withdrawing deletes what the category had already written', async ({ page }) => {
    await firstVisit(page);
    await page.getByRole('button', { name: 'Accept all' }).click();
    await page.reload();
    await expect
      .poll(async () => (await storageKeys(page)).includes(THEME_KEY))
      .toBe(true);

    await page.goto('/legal/cookies');
    await page.getByRole('button', { name: 'Change your preferences' }).click();
    await page.getByRole('button', { name: 'Save my choices' }).click();

    // Reopening clears the record, so saving with both switches off is a
    // withdrawal — and a withdrawal that leaves the old value on the device
    // is not a withdrawal.
    expect(await consentRecord(page)).toMatchObject({ preferences: false });
    expect(await storageKeys(page)).not.toContain(THEME_KEY);
  });

  test('a changed policy version asks again', async ({ page }) => {
    await firstVisit(page);
    await page.getByRole('button', { name: 'Accept all' }).click();
    await expect(banner(page)).toBeHidden();

    await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return;
      const record = JSON.parse(raw) as { version: number };
      record.version = record.version - 1;
      window.localStorage.setItem(key, JSON.stringify(record));
    }, CONSENT_KEY);
    await page.reload();

    await expect(banner(page)).toBeVisible();
  });

  test('a corrupt record fails safe to asking again', async ({ page }) => {
    await firstVisit(page);
    await page.evaluate(
      (key) => window.localStorage.setItem(key, '{not json'),
      CONSENT_KEY,
    );
    await page.reload();

    await expect(banner(page)).toBeVisible();
  });

  test('can be reopened from the footer after a decision', async ({ page }) => {
    await firstVisit(page);
    await page.getByRole('button', { name: 'Reject all' }).click();

    await page.goto('/legal/cookies');
    await page.getByRole('button', { name: 'Cookie preferences' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('the banner has no accessibility violations', async ({ page }) => {
    await firstVisit(page);
    await expect(banner(page)).toBeVisible();

    const results = await new AxeBuilder({ page })
      .exclude(AXE_EXCLUDE)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('the granular panel has no accessibility violations', async ({ page }) => {
    await firstVisit(page);
    await page.getByRole('button', { name: 'Choose what to keep' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .exclude(AXE_EXCLUDE)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('stays usable on a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await firstVisit(page);

    await expect(page.getByRole('button', { name: 'Accept all' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reject all' })).toBeVisible();

    // The page behind must not scroll sideways because of the banner.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflows).toBe(false);
  });

  test('does not cover the bottom of the page it sits on', async ({ page }) => {
    // The regression. This banner is `fixed bottom-0`, and "does not block the
    // page" was true of focus and false of pointers: CI failed the
    // authenticated signup because the banner intercepted the click on the
    // onboarding Continue button, which happened to sit at the foot of the
    // viewport. Every test above clicks the banner or something near the top,
    // so none of them could have seen it.
    await firstVisit(page, '/pricing');
    await expect(banner(page)).toBeVisible();

    const last = page.getByRole('button', { name: 'Cookie preferences' });
    await last.scrollIntoViewIfNeeded();

    // `trial: true` performs every actionability check, including the
    // hit-target test that failed in CI, without firing the click.
    await last.click({ trial: true, timeout: 5_000 });
  });

  test('reserves its own height, and gives it back once answered', async ({ page }) => {
    await firstVisit(page);

    const withBanner = await page.evaluate(
      () => getComputedStyle(document.body).paddingBottom,
    );
    expect(parseFloat(withBanner)).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Reject all' }).click();
    await expect(banner(page)).toBeHidden();

    const afterwards = await page.evaluate(
      () => getComputedStyle(document.body).paddingBottom,
    );
    expect(parseFloat(afterwards)).toBe(0);
  });

  test('does not block the page it sits on', async ({ page }) => {
    await firstVisit(page, '/legal/cookies');
    await expect(banner(page)).toBeVisible();

    // No overlay and no focus trap: the content is still reachable while the
    // question is unanswered, because the gate is in the write path.
    await expect(
      page.getByRole('heading', { name: /cookies and browser storage/i }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Privacy', exact: true }).first().click();
    await expect(page).toHaveURL(/\/legal\/privacy/);
  });
});
