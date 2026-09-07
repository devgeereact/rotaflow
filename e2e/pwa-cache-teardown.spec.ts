import { expect, test, type Page } from '@playwright/test';

/**
 * Cache teardown on an identity change, watched in a browser (GAP-072).
 *
 * ## Why this could not be written before
 *
 * `BUG-078` moved teardown off the `signOut` wrapper and onto every auth
 * transition, keyed on the user id changing rather than on an event name, so
 * that an expired token, a session revoked from another device and a second
 * account signing in on the same browser are all caught. The reasoning is
 * sound and it has never been executed. A unit test cannot reach it: the
 * failure lives in the service worker's `supabase-api` Cache Storage bucket,
 * not in React state.
 *
 * Two things were in the way, and both are now gone.
 *
 * **The service worker does not exist in dev.** `vite.config.ts` sets
 * `devOptions.enabled: false`, so the whole existing suite — which runs
 * against `npm run dev` because the `-preview` routes are DEV-only — has no
 * worker, no caches and nothing to assert. `playwright.config.ts` now has a
 * second project, `pwa`, serving a real production build through
 * `vite preview`. This spec is in it.
 *
 * **The cache rule did not match a local stack.** The `supabase-api` runtime
 * rule was pinned to `*.supabase.co`, so against a stack on `127.0.0.1` the
 * bucket was never written and a test would have passed while proving
 * nothing. The pattern is now derived from `VITE_SUPABASE_URL`
 * (`supabaseRestPattern` in `vite.config.ts`), which is a correctness fix in
 * its own right — a self-hosted or custom-domain Supabase got no offline
 * cache at all — and is what makes this observable.
 *
 * ## What it asserts
 *
 * That a response belonging to the outgoing user is in `caches` before the
 * identity changes and is gone after it, for the transition that matters
 * most: a SECOND ACCOUNT signing in on the same browser, which is the ward
 * tablet, and which the old `signOut`-only teardown missed entirely.
 *
 * It needs a Supabase stack on localhost and its service-role key, for the
 * same reason `platform-console.spec.ts` does, and refuses to run without
 * them rather than risk seeding a customer's database.
 */
const LIVE = process.env.E2E_LIVE_SUPABASE === '1';
const SERVICE_KEY = process.env.E2E_SERVICE_ROLE_KEY ?? '';
const API_URL = process.env.VITE_SUPABASE_URL ?? '';

async function createConfirmedUser(email: string, password: string): Promise<string> {
  const response = await fetch(`${API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: 'Cache', last_name: 'Tester' },
    }),
  });
  if (!response.ok) {
    throw new Error(`create user failed: ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { id: string }).id;
}

/** The organisation's id, read over the service role rather than scraped. */
async function organisationIdByName(name: string): Promise<string> {
  const response = await fetch(
    `${API_URL}/rest/v1/organisations?select=id&name=eq.${encodeURIComponent(name)}`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  if (!response.ok) {
    throw new Error(
      `read organisation failed: ${response.status} ${await response.text()}`,
    );
  }
  const rows = (await response.json()) as { id: string }[];
  const first = rows[0];
  if (rows.length !== 1 || first === undefined) {
    throw new Error(`expected one organisation named ${name}, got ${rows.length}`);
  }
  return first.id;
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const token = page.waitForRequest((request) =>
    request.url().includes('/auth/v1/token'),
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const origin = new URL((await token).url()).origin;
  expect(
    origin,
    `the app signed in against ${origin} but the fixture was seeded into ${API_URL} — a stale preview server is being reused`,
  ).toBe(new URL(API_URL).origin);
  await page.waitForURL(/\/(onboarding|app)/, { timeout: 60_000 });
}

/** Wait until a service worker is actually controlling the page. */
async function waitForController(page: Page): Promise<void> {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    undefined,
    { timeout: 60_000 },
  );
}

/** Every URL currently held in the named Cache Storage bucket. */
async function cachedUrls(page: Page, cacheName: string): Promise<string[]> {
  return page.evaluate(async (name) => {
    if (!(await caches.has(name))) return [];
    const cache = await caches.open(name);
    return (await cache.keys()).map((request) => request.url);
  }, cacheName);
}

/** The localStorage keys this product treats as belonging to one identity. */
async function tenantKeys(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(window.localStorage).filter(
      (key) => key === 'rotaflow:activeOrgId' || key.startsWith('rotaflow:workMode:'),
    ),
  );
}

test.describe('cache teardown on an identity change', () => {
  test.skip(
    !LIVE || SERVICE_KEY === '',
    'needs a local Supabase stack and its service-role key — see e2e-authenticated in ci.yml',
  );

  test('a second account signing in does not inherit the first one’s cached reads', async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const stamp = Date.now();
    const first = {
      email: `cache-a-${stamp}@example.test`,
      password: `Cache-A-${stamp}-Pw0rd`,
    };
    const second = {
      email: `cache-b-${stamp}@example.test`,
      password: `Cache-B-${stamp}-Pw0rd`,
    };
    const firstUserId = await createConfirmedUser(first.email, first.password);
    await createConfirmedUser(second.email, second.password);

    // ---- the first identity, with a warm cache -------------------------
    await signIn(page, first.email, first.password);
    await waitForController(page);

    // Create the organisation, which is the cheapest way to make the app
    // issue authenticated REST reads that the worker will cache.
    await page.goto('/onboarding');
    await page.getByLabel('Organisation name').fill(`Cache ${stamp}`);
    const create = page.getByRole('button', { name: /continue/i });
    await expect(create).toBeEnabled({ timeout: 30_000 });
    await create.click();
    await expect(
      page.getByRole('heading', { name: 'About your organisation', exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    await page.goto('/app/dashboard');
    await page.waitForLoadState('networkidle');

    // The worker writes asynchronously after the response is returned, so
    // poll rather than reading once: an empty bucket here would fail the test
    // for a timing reason and say nothing about teardown.
    await expect
      .poll(async () => (await cachedUrls(page, 'supabase-api')).length, {
        timeout: 30_000,
        message:
          'nothing reached the supabase-api cache — check supabaseRestPattern in vite.config.ts matches VITE_SUPABASE_URL',
      })
      .toBeGreaterThan(0);

    // The organisation's id, which is what makes the assertion after the
    // identity change specific rather than merely numeric.
    //
    // The first version asserted the bucket was EMPTY afterwards and failed,
    // and the failure was the test's fault rather than the product's: teardown
    // deletes the bucket and the incoming user's own reads immediately refill
    // it, so "empty" is a race with the second sign-in. What matters is not
    // that the cache is empty, it is that nothing belonging to the OUTGOING
    // user is still in it. Every org-scoped read carries `org_id=eq.<id>` in
    // its query string, and the second account has no organisation at all, so
    // that id is a reliable fingerprint for "this response was the first
    // user's".
    const orgId = await organisationIdByName(`Cache ${stamp}`);
    const warmed = await cachedUrls(page, 'supabase-api');
    expect(
      warmed.filter((url) => url.includes(orgId)),
      'no org-scoped response reached the cache, so the assertion after the identity change would be vacuous',
    ).not.toHaveLength(0);

    // Written here rather than driven through the UI, deliberately.
    //
    // `OrgContext.switchOrg` writes `rotaflow:activeOrgId` only when somebody
    // explicitly switches organisation, and the work-mode key only when
    // somebody switches mode. A first-run account has one organisation and no
    // staff profile, so neither happens and both keys are absent — which
    // would make the assertion after the identity change pass while proving
    // nothing. The subject under test is `clearTenantState`'s sweep, not the
    // code that writes the keys, so the keys are put there in exactly the
    // shape the app writes them: one exact key, and one carrying an id, which
    // is the case a fixed list cannot cover and the prefix sweep exists for.
    await page.evaluate((user) => {
      window.localStorage.setItem('rotaflow:activeOrgId', 'org-under-test');
      window.localStorage.setItem(`rotaflow:workMode:${user}:org-under-test`, 'my-work');
    }, firstUserId);
    expect(await tenantKeys(page)).toHaveLength(2);

    // ---- the second identity, same browser -----------------------------
    //
    // Not a sign-out. This is the transition the old teardown missed: the
    // session is REPLACED rather than ended, so `onAuthStateChange` fires with
    // a different user and nothing in the sign-out wrapper runs.
    await page.goto('/login');
    await page.getByLabel('Email address').fill(second.email);
    await page.getByLabel('Password', { exact: true }).fill(second.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(/\/(onboarding|app)/, { timeout: 60_000 });

    await expect
      .poll(
        async () =>
          (await cachedUrls(page, 'supabase-api')).filter((url) => url.includes(orgId)),
        {
          timeout: 30_000,
          message: `the first user’s cached responses survived the identity change (warmed with: ${warmed.join(', ')})`,
        },
      )
      .toHaveLength(0);

    expect(
      await tenantKeys(page),
      'the outgoing user’s active organisation or work-mode preference survived',
    ).toHaveLength(0);
  });
});
