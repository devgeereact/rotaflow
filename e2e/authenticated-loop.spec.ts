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

    expect(errors, 'uncaught errors during signup and org creation').toEqual([]);
  });
});
