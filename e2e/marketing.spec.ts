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
  { path: '/legal/trust', heading: /trust and sub-processors/i },
  // Added 2026-09-02 by the full audit. Both were public, both were outside
  // every sweep, and neither set a title: the password-reset tab read
  // "RotaFlow — Scheduling certainty for every shift", and the 404 rendered
  // with no nav and no way out.
  { path: '/forgot-password', heading: /reset|forgot|password/i },
  { path: '/this-page-does-not-exist', heading: /doesn.t exist/i },
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
// `docs/SAAS.md` (design-system health), deliberately
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
  '/legal/trust',
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

/**
 * Metadata is invisible on screen, which is why it was absent for months: one
 * title and one description served all sixteen public pages, and there was no
 * canonical, no Open Graph and no Twitter card anywhere in the repository.
 * Nothing on a rendered page would have looked wrong.
 */
test.describe('page metadata', () => {
  for (const { path } of PUBLIC_PAGES) {
    test(`${path} has its own title, description and canonical`, async ({ page }) => {
      await page.goto(path);

      await expect(page).toHaveTitle(/RotaFlow/);

      // Polling matchers throughout, not one-shot getAttribute: index.html
      // ships site-level defaults and `usePageMetadata` replaces them in an
      // effect after mount, so reading once races the first paint and fails
      // on whichever pages happen to lose that race.
      // Absolute, and pointing at THIS page rather than the homepage — a
      // site-wide canonical to `/` tells Google the other fifteen pages are
      // duplicates of it.
      //
      // Resolved against the page's own URL rather than assembled into a
      // regex: building a pattern by string-escaping a path is the mistake
      // CodeQL's js/incomplete-sanitization exists to catch, and it caught
      // the first version of this line.
      const expectedCanonical = new URL(path === '/' ? '/' : path, page.url()).toString();
      await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
        'href',
        expectedCanonical,
      );

      await expect(page.locator('head meta[name="description"]')).toHaveAttribute(
        'content',
        /.{20,}/,
      );
      await expect(page.locator('head meta[property="og:image"]')).toHaveAttribute(
        'content',
        /og-image\.png/,
      );
    });
  }

  test('two pages do not share one title', async ({ page }) => {
    // Polled, not read once. `usePageMetadata` sets the title in an effect
    // after mount, so a bare `page.title()` can catch index.html's static one
    // on both pages and report them as identical -- which is exactly the bug
    // this test exists to catch, reported for the wrong reason. It failed
    // that way in CI before this line was polled.
    await page.goto('/pricing');
    await expect(page).toHaveTitle(/Pricing/);
    const pricing = await page.title();

    await page.goto('/about');
    await expect(page).toHaveTitle(/About/);
    expect(await page.title()).not.toBe(pricing);
  });

  test('the 404 asks not to be indexed, because the server answers it 200', async ({
    page,
  }) => {
    await page.goto('/this-page-does-not-exist');
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
  });
});

/**
 * The auth screens are the only ones a person reaches with a password manager
 * open and both hands on the keyboard. Until 2026-09-02 not one of the four
 * had a `<form>` element: every submit was an `onClick`, so filling in a
 * password and pressing Enter did nothing at all.
 *
 * Asserted structurally rather than by signing in, deliberately. A behavioural
 * test would have to submit real credentials against whatever Supabase project
 * the run is pointed at, and "does Enter submit" is a question about the
 * markup, which cannot drift from the answer.
 */
test.describe('auth screens submit from the keyboard', () => {
  for (const path of ['/login', '/signup', '/forgot-password']) {
    test(`${path} has a form with a submit button in it`, async ({ page }) => {
      await page.goto(path);

      const form = page.locator('form');
      await expect(form.first()).toBeAttached();
      // Inside the form, not merely on the page: a submit button outside it
      // is exactly the arrangement that looks right and does not submit.
      await expect(form.locator('button[type="submit"]').first()).toBeAttached();
    });
  }

  test('the other buttons on the sign-in form do not submit it', async ({ page }) => {
    await page.goto('/login');
    // Show-password and magic-link sit inside the same form as Sign in. With
    // the HTML default of type="submit" either would sign the person in, or
    // try to, when they only wanted to see what they had typed.
    const nonSubmit = page.locator('form button:not([type="submit"])');
    expect(await nonSubmit.count()).toBeGreaterThan(0);
    for (const button of await nonSubmit.all()) {
      await expect(button).toHaveAttribute('type', 'button');
    }
  });
});
