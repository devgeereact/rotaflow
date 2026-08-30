import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Every screen behind a login, rendered and scanned (docs/SAAS.md GAP-010).
 *
 * ## What this covers, and what it does not
 *
 * `marketing.spec.ts` covers the 14 public pages. Until now that was the whole
 * suite, so **CI had never rendered a single screen from inside the product** —
 * not the rota builder, not clock-in, not one page of the platform console.
 *
 * That gap had already cost something. `Badge.tsx` shipped with every
 * `DEFAULT`-on-`wash` tone failing WCAG AA — warning at 2.04:1 against a 4.5:1
 * minimum — and an app-wide contrast audit knowingly left it open. The axe gate
 * did not catch it for weeks because Badge appears on no public page. It failed
 * the moment one landed on `/legal/trust`. These routes are where Badge, and
 * every other shared component, actually lives.
 *
 * What this does NOT do is drive a real session. `playwright.config.ts` runs
 * `npm run dev` with no Supabase credentials, and the `-preview` routes below
 * exist precisely so a role-specific screen can be reached without one — they
 * render the real components against fixtures. So this proves a screen renders
 * and meets WCAG basics; it does not prove sign-in works, or that publishing a
 * rota makes a shift appear for the staff member it was assigned to.
 *
 * That half of GAP-010 needs a local Supabase stack in CI and a seeded
 * organisation, and it is deliberately not attempted here — see the register.
 *
 * ## Why a heading assertion and not just a 200
 *
 * A React error boundary, a failed lazy chunk and a route that quietly renders
 * `NotFoundPage` all return 200 with a valid HTML document. The heading is the
 * cheapest thing that distinguishes "this screen rendered" from "something
 * rendered".
 */

/** Screens inside the organisation workspace. */
const APP_SCREENS = [
  // The dashboard's h1 is a greeting, not a page title. Matched as written
  // rather than loosening the assertion until it would pass on anything —
  // `NotFoundPage` has an h1 too, so a permissive regex proves nothing.
  { path: '/dashboard-preview', heading: /good (morning|afternoon|evening)/i },
  { path: '/rota-builder-preview', heading: /^rota builder$/i },
  { path: '/schedule-preview', heading: /^schedule$/i },
  { path: '/timesheets-preview', heading: /^timesheets$/i },
  { path: '/clockin-preview', heading: /^clock in$/i },
  { path: '/staff-preview', heading: /^team$/i },
  { path: '/locations-preview', heading: /^locations$/i },
  // Departments is a tab within Locations and keeps that h1.
  { path: '/locations-preview/departments', heading: /^locations$/i },
  { path: '/announcements-preview', heading: /^announcements$/i },
  { path: '/reports-preview', heading: /^reports$/i },
  { path: '/onboarding-preview', heading: /set up your organisation/i },
];

/**
 * The platform console. Every one of these is a screen a platform
 * administrator makes decisions on, and several were rebuilt recently — the
 * demo-constant removal touched three of them.
 */
const CONSOLE_SCREENS = [
  { path: '/admin-preview', heading: /^platform overview$/i },
  { path: '/admin-preview/organisations', heading: /^organisations$/i },
  { path: '/admin-preview/users', heading: /^users$/i },
  { path: '/admin-preview/subscriptions', heading: /^subscriptions$/i },
  { path: '/admin-preview/billing', heading: /^billing and finance$/i },
  { path: '/admin-preview/support', heading: /^support centre$/i },
  { path: '/admin-preview/support-access', heading: /^temporary support access$/i },
  { path: '/admin-preview/platform-health', heading: /^system status$/i },
  { path: '/admin-preview/incidents', heading: /^incidents$/i },
  { path: '/admin-preview/integrations', heading: /^integrations$/i },
  { path: '/admin-preview/notifications', heading: /^platform notifications$/i },
  { path: '/admin-preview/audit', heading: /^audit logs$/i },
  { path: '/admin-preview/feature-flags', heading: /^feature flags$/i },
  { path: '/admin-preview/gdpr', heading: /^gdpr and data management$/i },
  { path: '/admin-preview/settings', heading: /^platform settings$/i },
];

const ALL_SCREENS = [...APP_SCREENS, ...CONSOLE_SCREENS];

/**
 * `vite-plugin-checker`'s error overlay is a real custom element in the DOM in
 * dev mode. Excluded for the same reason `marketing.spec.ts` excludes it: it is
 * dev-server furniture, not part of the product.
 */
const AXE_EXCLUDE = 'vite-plugin-checker-error-overlay';

for (const { path, heading } of ALL_SCREENS) {
  test(`${path} renders`, async ({ page }) => {
    const errors: string[] = [];
    // A screen that throws after mounting still shows a heading. The console
    // is where that shows up, and a silent one is most of the value here.
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    expect(errors, `uncaught errors on ${path}`).toEqual([]);
  });
}

/**
 * Colour-contrast debt, measured 2026-08-30. It can go down and not up.
 *
 * Adding these 26 screens to the gate surfaced 303 WCAG violations that CI had
 * never seen. All but the contrast ones are fixed in the same change and are
 * asserted at zero below. The remaining 172 are one pre-existing cause: the
 * status palette used as *text*, where `DEFAULT` sits between 2.04:1 and
 * 3.70:1 against a 4.5:1 minimum. `tailwind.config.ts` predicted exactly this —
 * "the same `text-primary`-as-link pattern likely exists in authenticated
 * `/app` screens too and needs the same swap as part of the sitewide
 * design-system contrast pass".
 *
 * They are NOT fixed here, deliberately. The fix is mechanical but touches 189
 * class occurrences across the app, and restyling half the product inside a
 * change whose purpose is to add test coverage would be unreviewable and
 * unverifiable screen by screen. It is tracked on its own.
 *
 * A TOTAL rather than a per-screen budget, because System status runs live
 * probes whose results change what renders, so its count can move between runs.
 * A total absorbs that without the gate going flaky, and still means no change
 * can add contrast debt overall.
 *
 * The figure was 277 when this suite was written and is 172 now: fixing
 * `Badge.tsx`'s five tones, which landed separately, removed 105 nodes on its
 * own. The budget is set to the current measurement rather than left at the old
 * one — a ceiling 114 above the actual value is not a gate. Three consecutive
 * runs all read exactly 172, so there is no variance to absorb today; if a
 * future run proves otherwise, raise it to the observed maximum and say so here
 * rather than padding it pre-emptively.
 *
 * Lower it whenever the debt is paid down. Never raise it to make a change pass.
 */
const CONTRAST_BUDGET = 172;

test('the authenticated surface has no non-contrast WCAG violations', async ({
  page,
}) => {
  // A hard zero, unlike contrast. These are the violations that were fixable
  // in the same change: six inline links distinguished from their surrounding
  // prose by colour alone, and one horizontally-scrolling table a keyboard
  // user could not reach into.
  const offenders: string[] = [];

  for (const { path } of ALL_SCREENS) {
    await page.goto(path);
    await expect(page.getByRole('heading').first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .exclude(AXE_EXCLUDE)
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    for (const violation of results.violations) {
      if (violation.id === 'color-contrast') continue;
      offenders.push(`${path}: ${violation.id} (${violation.nodes.length})`);
    }
  }

  expect(offenders).toEqual([]);
});

test('colour-contrast debt does not grow', async ({ page }) => {
  let total = 0;
  const perScreen: string[] = [];

  for (const { path } of ALL_SCREENS) {
    await page.goto(path);
    await expect(page.getByRole('heading').first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .exclude(AXE_EXCLUDE)
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const count = results.violations
      .filter((v) => v.id === 'color-contrast')
      .reduce((n, v) => n + v.nodes.length, 0);
    if (count > 0) perScreen.push(`${path}: ${count}`);
    total += count;
  }

  // Printed whether or not it passes, so the number is visible on every run and
  // a reduction gets noticed rather than only a regression — the same reason
  // the bundle-size gate prints its figures. This is the one place the debt is
  // actually counted, so it is worth a line in the log.
  // eslint-disable-next-line no-console
  console.log(
    `colour-contrast nodes: ${total} / ${CONTRAST_BUDGET}\n  ${perScreen.join('\n  ')}`,
  );

  expect(
    total,
    `Colour-contrast violations went up. Either fix them, or if you have genuinely ` +
      `reduced the debt elsewhere, lower CONTRAST_BUDGET to the new total — never raise it.`,
  ).toBeLessThanOrEqual(CONTRAST_BUDGET);
});
