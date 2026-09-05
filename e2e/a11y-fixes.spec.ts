import { expect, test } from '@playwright/test';

/**
 * The skip link (WCAG 2.2 Level A, 2.4.1 Bypass Blocks), added 2026-09-05.
 *
 * Focus is set directly rather than by simulating Tab: tab order from a
 * detached element is not reliable across engines, and the thing worth
 * asserting is the mechanism — that activating the link moves FOCUS into
 * `main`, not merely the viewport. That only works because `main` carries
 * `tabIndex={-1}`, which is the part quietly omitted in most attempts.
 */
test('the skip link is the first anchor and moves focus into main', async ({ page }) => {
  await page.goto('/');

  const firstAnchorText = await page.evaluate(
    () => document.querySelector('a')?.textContent?.trim() ?? '',
  );
  expect(firstAnchorText).toMatch(/skip to main content/i);

  const skip = page.getByRole('link', { name: /skip to main content/i });
  await skip.focus();
  await expect(skip).toBeVisible(); // `focus:not-sr-only` brings it into view
  await skip.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});
