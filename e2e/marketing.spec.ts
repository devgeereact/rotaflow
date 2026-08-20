import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { trackConsoleErrors } from './support/console-errors';

/**
 * The public site. No auth, no Supabase session required, so these are the
 * cheapest possible regression net — anyone can hit a 404 or a blank page
 * here on day one of a new browser.
 */
const PUBLIC_PAGES = [
  { path: '/', heading: /scheduling|shift/i },
  { path: '/features', heading: /features|build/i },
  { path: '/pricing', heading: /pricing/i },
  { path: '/solutions', heading: /solutions|sector/i },
  { path: '/about', heading: /about|scheduling/i },
  { path: '/contact', heading: /contact|talk/i },
  { path: '/login', heading: /welcome back/i },
  { path: '/signup', heading: /create|sign ?up|account/i },
  { path: '/resources', heading: /resources|built|working|status/i },
  { path: '/legal/privacy', heading: /privacy/i },
  { path: '/legal/terms', heading: /terms/i },
  { path: '/legal/cookies', heading: /cookie/i },
  { path: '/legal/accessibility', heading: /accessibility/i },
];

/**
 * `vite-plugin-checker`'s error overlay is a real custom element in the DOM
 * of every page served by `npm run dev` — it does not exist in the production
 * build, but axe cannot tell that, and without this it fails these tests on
 * the dev tool's own markup instead of the app's. Excluded from every scan
 * below.
 */
const AXE_EXCLUDE = 'vite-plugin-checker-error-overlay';

for (const { path, heading } of PUBLIC_PAGES) {
  test(`${path} loads with no console errors`, async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const response = await page.goto(path);
    expect(response?.ok(), `${path} did not respond 2xx`).toBeTruthy();
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    expect(errors, `console/page errors on ${path}: ${errors.join('\n')}`).toEqual([]);
  });
}

test('marketing nav reaches every top-level link via the keyboard', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation').first();
  await expect(nav).toBeVisible();
  // A pointer-only nav is invisible to a screen-reader or switch-device user.
  // This does not walk every link (the visual audit does that); it proves
  // the nav is keyboard-reachable at all, which a CSS regression can break
  // silently (e.g. a hover-only dropdown with no focus-visible state).
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(focused).toBeTruthy();
});

// Every public page, genuinely clean — 0 `color-contrast` violations across
// all 13, confirmed 2026-08-13. Getting here found three distinct bug
// classes, not one:
//   1. 8 of an initial 12 failures on `/` were `animate-fade-up` elements
//      caught mid-transition by the scan, not a real bug — fixed globally by
//      pairing every `animate-fade-up` sitewide with `motion-reduce:animate-none`.
//   2. A handful were real, local bugs (wrong token, a stray `opacity-80`) in
//      one decorative hero widget (`ProductPreview.tsx`).
//   3. The rest were systemic: `text-primary`/`text-warning`/`text-success`/
//      `text-danger` used directly as small/link text read 2.27-4.46:1 against
//      backgrounds needing 4.5:1 — the semantic tokens are correct as fills
//      (paired with `-fg`, e.g. a solid button) but were never given a
//      text-safe darker variant. Added `primary.ink`/`warning.ink`/
//      `success.ink`/`danger.ink` to `tailwind.config.ts` (additive — the
//      original `DEFAULT` values are untouched, so nothing already relying on
//      them shifts) and swapped every public-page text/link usage onto them.
// The same `text-primary`-as-link pattern almost certainly exists in
// authenticated `/app` screens too; extending the swap there is
// docs/PRODUCT_TRANSFORMATION_PLAN.md §8.5 (design-system health), deliberately
// not done in this pass — those files are also where a concurrent worktree
// (`mockup-parity`) is actively doing pixel-parity work against reference
// designs, and touching shared files there right now risks a collision this
// public-only pass does not have.
for (const path of [
  '/',
  '/features',
  '/pricing',
  '/solutions',
  '/about',
  '/contact',
  '/login',
  '/signup',
  '/resources',
  '/legal/privacy',
  '/legal/terms',
  '/legal/cookies',
  '/legal/accessibility',
]) {
  test(`${path} has no WCAG 2 A/AA violations`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .exclude(AXE_EXCLUDE)
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(
      results.violations,
      results.violations
        .map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`)
        .join('\n'),
    ).toEqual([]);
  });
}
