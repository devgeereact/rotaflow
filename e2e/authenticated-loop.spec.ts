import { expect, test } from '@playwright/test';

/**
 * The first test that signs in (docs/SAAS.md GAP-010).
 *
 * ## What was missing
 *
 * `marketing.spec.ts` covers the public pages and `app-surface.spec.ts`
 * renders 26 authenticated screens — but through `-preview` routes, which
 * mount the real components against fixtures with no session at all. That
 * proves a screen renders. It proves nothing about signing in, about RLS
 * scoping a query to the right organisation, or about a write landing.
 *
 * The register was explicit that this half needed "a local Supabase stack in
 * CI and a seeded organisation", and that it was deliberately not attempted.
 * This is that.
 *
 * ## What it exercises, and why this path
 *
 * Sign up → create an organisation → land on the dashboard. That is the
 * narrowest path that touches the things preview routes cannot:
 *
 *   * a real GoTrue session, and the app's handling of one;
 *   * `handle_new_user`, the trigger that makes a profile;
 *   * `create_organisation` and `on_org_created`, which bootstraps the
 *     owner membership — the tenant-bootstrap RLS problem this schema is
 *     built around;
 *   * `OrgContext` reading a membership back through RLS as the user.
 *
 * It is also the exact path `docs/QA-AUDIT-REPORT.md` found broken at step 1:
 * "a completely new customer cannot get past step 1 of setting up their
 * organisation today". Nothing in CI has been able to catch that recurring.
 *
 * ## Why it is skipped unless CI says otherwise
 *
 * It needs a Supabase stack on localhost. Running it against the developer's
 * `.env` would point it at PRODUCTION and create real organisations in a
 * customer's database — so it refuses to run unless `E2E_LIVE_SUPABASE` is
 * set, which only the `e2e-authenticated` job does, after `supabase start`.
 *
 * A skipped test that could have written to production is the right default.
 */
const LIVE = process.env.E2E_LIVE_SUPABASE === '1';

test.describe('the authenticated loop', () => {
  test.skip(!LIVE, 'needs a local Supabase stack — see e2e-authenticated in ci.yml');

  test('a new customer can sign up and create an organisation', async ({ page }) => {
    test.setTimeout(120_000);

    // Unique per run: the local stack is reset per job, but a retry inside one
    // job reuses it, and a duplicate email would fail for the wrong reason.
    const stamp = Date.now();
    const email = `e2e-${stamp}@example.test`;
    const password = `E2e-${stamp}-Passw0rd`;
    const orgName = `E2E Care ${stamp}`;

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // ---- sign up ------------------------------------------------------
    await page.goto('/signup');
    await page.getByLabel('First name').fill('E2E');
    await page.getByLabel('Last name').fill('Tester');
    await page.getByLabel('Work email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);

    // The on-screen checklist mirrors GoTrue's real rule — 12 characters, one
    // of each case, a digit (0092/GAP-031). If this button will not enable,
    // the two have drifted, which is exactly the bug `src/lib/password.ts`
    // exists to prevent: a green checklist and a server rejection.
    const submit = page.getByRole('button', { name: 'Create account' });
    await expect(submit).toBeEnabled();
    await submit.click();

    // Local Supabase auto-confirms, so signup lands straight in the app.
    // `/onboarding` is where a user with no organisation belongs.
    await page.waitForURL(/\/onboarding/, { timeout: 60_000 });

    // ---- create the organisation --------------------------------------
    await page.getByLabel('Organisation name').fill(orgName);

    // The slug is derived from the name as you type, and `Continue` stays
    // disabled until `slug_available` has answered. Waiting for the button
    // rather than for a fixed delay is what makes that check part of the test
    // instead of a race with it.
    const create = page.getByRole('button', { name: /continue/i });
    await expect(create).toBeEnabled({ timeout: 30_000 });
    await create.click();

    // Step 2 means step 1 wrote a real row AND the owner membership came back
    // through RLS. This is the assertion the whole test exists for: it is the
    // step QA-AUDIT-REPORT found a new customer could not get past.
    //
    // Matched exactly, and on the step's own h2. The left panel carries an h1
    // reading "Tell us about your organisation", so a loose regex resolves to
    // two elements and fails strict mode — with the product working perfectly.
    await expect(
      page.getByRole('heading', { name: 'About your organisation', exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    // ---- step 2: save the details, which is a plain table write --------
    //
    // Everything above this line goes through `create_organisation`, a
    // SECURITY DEFINER function, so it proves nothing about what a signed-in
    // user may write directly. Step 2 PATCHes `organisations` over PostgREST
    // and is the first thing in the journey needing a column-level GRANT
    // rather than a policy.
    //
    // It is also where the wizard was stuck for every customer until
    // 2026-09-04 (GAP-061): `0017` scoped the UPDATE grant to four columns,
    // `0023` added three more, and the grant never followed. The screen said
    // "Could not save those details. Please try again." and pressing Continue
    // again did the same thing forever. This test asserted the heading above
    // and stopped one click short of it, which is why nothing caught it.
    //
    // Advancing to step 3 is the assertion: `handleAbout` only reaches
    // `setStep(3)` after `updateOrganisation` and `mergeOrgSettings` have both
    // resolved, so the heading changing is proof the write landed. The form is
    // left untouched deliberately — every field it needs already has a usable
    // default, and a customer who accepts them must not be stuck.
    await page.getByRole('button', { name: /^continue$/i }).click();
    await expect(
      page.getByRole('heading', { name: 'Invite your team', exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    // The failure this guards renders an alert rather than throwing, so assert
    // the absence of one too: a regression that stalled the wizard while still
    // changing the heading would otherwise pass.
    await expect(page.getByRole('alert')).toHaveCount(0);

    expect(errors, 'uncaught errors during signup and org creation').toEqual([]);
  });

  test('the rota builder opens on the week its toolbar is describing', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const stamp = Date.now();
    const email = `e2e-rota-${stamp}@example.test`;
    const password = `E2e-${stamp}-Passw0rd`;

    // The consent banner is `fixed bottom-0` and covers the page until it is
    // answered, so the grid this test measures is never reachable without it.
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
        /* not this test's subject */
      }
    });

    await page.goto('/signup');
    await page.getByLabel('First name').fill('Rota');
    await page.getByLabel('Last name').fill('Opener');
    await page.getByLabel('Work email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 60_000 });

    await page.getByLabel('Organisation name').fill(`E2E Rota ${stamp}`);
    const create = page.getByRole('button', { name: /continue/i });
    await expect(create).toBeEnabled({ timeout: 30_000 });
    await create.click();
    await expect(
      page.getByRole('heading', { name: 'About your organisation', exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    // A primary location, because the builder refuses to draw a grid for an
    // organisation with nowhere to work.
    await page.getByLabel('Primary location name').fill('E2E House');
    await page.getByRole('button', { name: /^done$/i }).click();

    // The rest of the wizard, because `/app/*` sends an organisation with
    // onboarding still open back to `/onboarding`.
    await page.getByRole('button', { name: /^continue$/i }).click();
    await expect(
      page.getByRole('heading', { name: 'Invite your team', exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /skip for now/i }).click();
    await expect(
      page.getByRole('heading', { name: 'Choose your plan', exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /^continue$/i }).click();
    await page.getByRole('button', { name: /go to dashboard/i }).click();
    await page.waitForURL(/\/app\//, { timeout: 60_000 });

    // One person, because the grid draws rows and there is nothing to
    // measure against an organisation with nobody in it.
    await page.goto('/app/team');
    await page
      .getByRole('button', { name: /add staff/i })
      .first()
      .click();
    await page.getByLabel('First name').fill('Ada');
    await page.getByLabel('Last name').fill('Nkemdirim');
    await page
      .getByRole('button', { name: /^(save|add staff|create)/i })
      .last()
      .click();
    await expect(page.getByRole('link', { name: 'Ada Nkemdirim' })).toBeVisible({
      timeout: 60_000,
    });

    await page.goto('/app/rota');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Rota Builder' }),
    ).toBeVisible({ timeout: 60_000 });

    // Every-site-at-once shows only people who already have a shift, so a
    // first rota is started by choosing one. The empty state offers that as a
    // button; using it is also what proves the button does what it says.
    await page.getByRole('button', { name: /^Show / }).click();

    const region = page.getByRole('region', { name: 'Rota grid' });
    await expect(region).toBeVisible({ timeout: 60_000 });

    // The canvas is three weeks wide with the anchor week in the middle
    // (`rotaCanvas.ts`), and a scrolling element starts at `scrollLeft: 0`.
    // Until this was fixed the builder opened showing the *previous* week:
    // "Publish (n changes)" and the blocking-issue count both described a week
    // that was off the right-hand edge, and on a new organisation that is a
    // screen of empty cells.
    //
    // Asserted by geometry rather than by a scrollLeft number, because the
    // number depends on column widths and would have to be rewritten whenever
    // they change. What matters is that the anchor week is the part on screen.
    const anchor = region.locator('[data-rota-anchor-week]');
    await expect(anchor).toHaveCount(1);

    const anchorBox = (await anchor.boundingBox())!;
    const regionBox = (await region.boundingBox())!;
    const staffColWidth =
      (await region.locator('[data-rota-staff-col]').boundingBox())?.width ?? 0;

    // Its left edge sits just past the pinned staff column, not off screen to
    // the right, and not scrolled away to the left.
    expect(anchorBox.x).toBeGreaterThanOrEqual(regionBox.x - 2);
    expect(anchorBox.x).toBeLessThanOrEqual(regionBox.x + staffColWidth + 4);
  });
});
